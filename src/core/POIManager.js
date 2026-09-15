import * as THREE from 'three';
import { SpatialCardCanvas } from './poi/SpatialCardCanvas.js';
import { POI_PRESETS } from '../data/poiPresets.js';

/**
 * 3D POI 핀 및 VR 인포 카드 기하학적 치수 및 비주얼 설정 상수
 */
export const POI_VISUAL_CONFIG = {
  CONE_HEIGHT: 0.060,
  CONE_RADIUS: 0.022,
  CONE_SEGMENTS: 20,
  SPHERE_RADIUS: 0.016,
  SPHERE_SEGMENTS: 16,
  SPHERE_Y_OFFSET_FACTOR: 0.7,
  RING_INNER: 0.022,
  RING_OUTER: 0.040,
  RING_SEGMENTS: 24,
  RING_Y_OFFSET: 0.025,
  HITBOX_RADIUS: 0.16,
  HITBOX_SEGMENTS: 8,
  CARD_WIDTH: 0.42,
  CARD_HEIGHT: 0.21,
  CARD_Y_OFFSET: 0.22,
  COLOR_HAPTIC: 0xf59e0b,
  COLOR_DEFAULT: 0x00f0ff,
  COLOR_CORE: 0xffffff,
  RENDER_ORDER_PIN: 200,
  RENDER_ORDER_CONE: 201,
  RENDER_ORDER_SPHERE: 202,
  RENDER_ORDER_CARD: 300
};

/**
 * 3D POI(Point of Interest) 메타데이터 핀 관리자
 * 3DGS 씬 내부의 시공간 메타데이터 핀 배치, 애니메이션, 레이캐스팅 피킹, WebGL 메모리 관리
 */
export class POIManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene - 가상 Three.js 씬
   * @param {THREE.PerspectiveCamera} options.camera - 카메라
   * @param {THREE.WebGLRenderer} [options.renderer] - 렌더러
   * @param {Function} [options.onPOISelect] - 핀 선택 콜백
   */
  constructor(options = {}) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.renderer = options.renderer || null;
    this.onPOISelect = options.onPOISelect || (() => {});

    this.poiGroup = new THREE.Group();
    this.poiGroup.name = 'POIGroup';
    this.scene.add(this.poiGroup);

    this.pins = [];
    this.hitBoxes = []; // 핫 루프 내 중첩 탐색 제거용 히트박스 캐시
    this.selectedPin = null;

    this.raycaster = new THREE.Raycaster();

    // 핫 루프(Hot Loop) 무할당(Zero-allocation) 전용 스크래치 객체
    this._tempCamPos = new THREE.Vector3();
    this._tempPinPos = new THREE.Vector3();
    this._tempPointer = new THREE.Vector2();
    this._raycastIntersects = []; // raycaster.intersectObjects 재사용 결과 버퍼

    // 2D 캔버스 텍스처 팩토리 위임 인스턴스
    this.cardCanvasRenderer = new SpatialCardCanvas(512, 256);
    this.cardTexture = this.cardCanvasRenderer.getTexture();

    // VR 공간 전용 3D 플로팅 정보 카드 메쉬
    this.vrCardMesh = this.createVRCardMesh();
    this.scene.add(this.vrCardMesh);

    this.initDefaultPins();
  }

  /**
   * 외부(XRInteractionManager 등)에서 POI 그룹 전체의 월드 트랜스폼을 일괄 갱신하는 캡슐화 인터페이스
   */
  setTransform(position, quaternion, scale) {
    if (this.poiGroup) {
      if (position) this.poiGroup.position.copy(position);
      if (quaternion) this.poiGroup.quaternion.copy(quaternion);
      if (typeof scale === 'number' && Number.isFinite(scale)) this.poiGroup.scale.setScalar(scale);
    }
  }

  /**
   * VR 세션 내에 텍스트와 메타데이터를 표시할 3D Canvas 텍스처 패널 생성
   */
  createVRCardMesh() {
    const geometry = new THREE.PlaneGeometry(POI_VISUAL_CONFIG.CARD_WIDTH, POI_VISUAL_CONFIG.CARD_HEIGHT);
    const material = new THREE.MeshBasicMaterial({
      map: this.cardTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'VR_POI_InfoCard';
    mesh.visible = false;
    mesh.renderOrder = POI_VISUAL_CONFIG.RENDER_ORDER_CARD; // 핀 및 스플랫보다 최상위에 렌더링
    return mesh;
  }

  /**
   * 2D Canvas에 POI 메타데이터 렌더링 후 텍스처 갱신 (SpatialCardCanvas에 위임)
   */
  updateVRCardTexture(poiData) {
    if (this.cardCanvasRenderer) {
      this.cardCanvasRenderer.renderCard(poiData);
    }
  }

  /**
   * 분재 씬 좌표계에 정합된 기본 프리셋 핀 로드
   */
  initDefaultPins() {
    this.loadPreset('bonsai');
  }

  /**
   * 프리셋 모델별 전용 POI 핀 로드 (외부 poiPresets.js 모듈에서 데이터 취득)
   */
  loadPreset(presetKey) {
    this.clearPins();

    const presets = POI_PRESETS[presetKey];
    if (Array.isArray(presets)) {
      presets.forEach(data => {
        this.addPOI({
          ...data,
          coordinates: new THREE.Vector3(data.coordinates.x, data.coordinates.y, data.coordinates.z)
        });
      });
    }
  }

  /**
   * 신규 3D POI 핀 생성 및 씬 등록 (컴팩트하고 날렵한 정밀 포인터 핀)
   */
  addPOI(data) {
    const pin = new THREE.Group();
    pin.name = `POI_${data.id}`;
    pin.position.copy(data.coordinates);
    pin.userData = { ...data, baseY: data.coordinates.y };

    console.log(`[POIManager] 핀 생성됨 -> ID: ${data.id}, 좌표: (${data.coordinates.x.toFixed(3)}, ${data.coordinates.y.toFixed(3)}, ${data.coordinates.z.toFixed(3)})`);

    const typeColor = data.type === 'haptic' ? POI_VISUAL_CONFIG.COLOR_HAPTIC : POI_VISUAL_CONFIG.COLOR_DEFAULT;

    // 1) 포인터 원뿔 (꼭짓점이 정확히 로컬 Y = 0.00에 위치하도록 피벗 정렬)
    const coneHeight = POI_VISUAL_CONFIG.CONE_HEIGHT;
    const coneRadius = POI_VISUAL_CONFIG.CONE_RADIUS;
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, POI_VISUAL_CONFIG.CONE_SEGMENTS);
    coneGeo.rotateX(Math.PI);
    coneGeo.translate(0, coneHeight / 2, 0);

    const coneMat = new THREE.MeshStandardMaterial({
      color: typeColor,
      emissive: typeColor,
      emissiveIntensity: 1.2,
      roughness: 0.15,
      metalness: 0.85,
      depthTest: false,
      depthWrite: false
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.name = 'cone';
    pin.add(cone);

    // 2) 원뿔 상단에 얹힌 발광 화이트 코어 구체
    const sphereRadius = POI_VISUAL_CONFIG.SPHERE_RADIUS;
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, POI_VISUAL_CONFIG.SPHERE_SEGMENTS, POI_VISUAL_CONFIG.SPHERE_SEGMENTS);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: POI_VISUAL_CONFIG.COLOR_CORE,
      depthTest: false,
      depthWrite: false
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = coneHeight + sphereRadius * POI_VISUAL_CONFIG.SPHERE_Y_OFFSET_FACTOR;
    sphere.name = 'sphere';
    pin.add(sphere);

    // 3) 수평 펄스 링 (원뿔 중간 높이에 배치하여 표면 간섭 방지)
    const ringGeo = new THREE.RingGeometry(POI_VISUAL_CONFIG.RING_INNER, POI_VISUAL_CONFIG.RING_OUTER, POI_VISUAL_CONFIG.RING_SEGMENTS);
    const ringMat = new THREE.MeshBasicMaterial({
      color: typeColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = POI_VISUAL_CONFIG.RING_Y_OFFSET;
    ring.name = 'ring';
    pin.add(ring);

    // 4) 충돌 판정용 넉넉한 판정 구체 (피킹용)
    const hitGeo = new THREE.SphereGeometry(POI_VISUAL_CONFIG.HITBOX_RADIUS, POI_VISUAL_CONFIG.HITBOX_SEGMENTS, POI_VISUAL_CONFIG.HITBOX_SEGMENTS);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const hitBox = new THREE.Mesh(hitGeo, hitMat);
    hitBox.position.y = coneHeight / 2;
    hitBox.userData = { isPOIHitBox: true, pinRef: pin };
    pin.add(hitBox);

    // 렌더링 우선순위 부여 (3DGS 스플랫 위에 항시 선명하게 표시)
    pin.renderOrder = POI_VISUAL_CONFIG.RENDER_ORDER_PIN;
    cone.renderOrder = POI_VISUAL_CONFIG.RENDER_ORDER_CONE;
    sphere.renderOrder = POI_VISUAL_CONFIG.RENDER_ORDER_SPHERE;
    ring.renderOrder = POI_VISUAL_CONFIG.RENDER_ORDER_PIN;

    this.poiGroup.add(pin);
    this.pins.push(pin);
    this.hitBoxes.push(hitBox); // 히트박스 캐시에 추가

    return pin;
  }

  pickWithPointer(mouseX, mouseY, camera) {
    this._tempPointer.set(mouseX, mouseY);
    this.raycaster.setFromCamera(this._tempPointer, camera);
    return this._checkIntersections();
  }

  pickWithRay(origin, direction) {
    this.raycaster.set(origin, direction);
    return this._checkIntersections();
  }

  /**
   * 레이저가 POI 핀을 조준하고 있는지 비파괴 검사 (Hover 감지용 - 무할당 최적화)
   */
  checkRayHover(origin, direction) {
    if (this.hitBoxes.length === 0) return null;

    this.raycaster.set(origin, direction);
    this._raycastIntersects.length = 0;
    this.raycaster.intersectObjects(this.hitBoxes, false, this._raycastIntersects);

    if (this._raycastIntersects.length > 0) {
      return this._raycastIntersects[0].object.userData?.pinRef || null;
    }
    return null;
  }

  _checkIntersections() {
    if (this.hitBoxes.length === 0) return null;

    this._raycastIntersects.length = 0;
    this.raycaster.intersectObjects(this.hitBoxes, false, this._raycastIntersects);

    if (this._raycastIntersects.length > 0) {
      const hitBox = this._raycastIntersects[0].object;
      const pin = hitBox.userData?.pinRef;
      if (pin && pin.userData) {
        this.selectPin(pin);
        return pin.userData;
      }
    }
    return null;
  }

  selectPin(pin) {
    if (this.selectedPin === pin && this.vrCardMesh.visible) {
      // 이미 선택된 핀을 다시 클릭하면 VR 카드 닫기 토글
      this.selectedPin = null;
      this.vrCardMesh.visible = false;
      console.log(`POIManager: 핀 선택 해제 -> ${pin.userData.title}`);
      return;
    }

    this.selectedPin = pin;
    this.updateVRCardTexture(pin.userData);

    // VR 카드를 핀 상단 위치에 배치 (재사용 벡터로 할당 차단)
    pin.getWorldPosition(this._tempPinPos);
    this.vrCardMesh.position.copy(this._tempPinPos);
    this.vrCardMesh.position.y += POI_VISUAL_CONFIG.CARD_Y_OFFSET;
    this.vrCardMesh.visible = true;

    this.onPOISelect(pin.userData);
    console.log(`POIManager: 핀 선택됨 -> ${pin.userData.title} (VR 3D 카드 활성화)`);
  }

  hideVRCard() {
    this.selectedPin = null;
    if (this.vrCardMesh) {
      this.vrCardMesh.visible = false;
    }
  }

  /**
   * VR 진입 시 기본 또는 선택된 POI의 3D 정보 카드를 즉시 표시
   */
  showDefaultVRCard() {
    if (this.pins.length > 0) {
      const pin = this.selectedPin || this.pins[0];
      this.selectPin(pin);
    }
  }

  update(time = 0) {
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];

      // 꼭짓점 위치는 표면에 안정적으로 고정하고, 원뿔만 부드럽게 Y축 자전
      const cone = pin.getObjectByName('cone');
      const ring = pin.getObjectByName('ring');
      const sphere = pin.getObjectByName('sphere');

      if (cone) {
        cone.rotation.y = time * 0.8 + i;
      }

      if (ring) {
        const pulse = 1.0 + Math.sin(time * 3 + i * 2) * 0.25;
        ring.scale.set(pulse, pulse, pulse);
      }

      if (sphere) {
        const bounce = 1.0 + Math.sin(time * 4 + i) * 0.1;
        sphere.scale.set(bounce, bounce, bounce);
      }
    }

    // VR 플로팅 카드 빌보드 (무할당: 재사용 벡터 활용)
    if (this.vrCardMesh && this.vrCardMesh.visible) {
      const activeCam = (this.renderer?.xr?.isPresenting) ? this.renderer.xr.getCamera() : this.camera;
      if (activeCam) {
        activeCam.getWorldPosition(this._tempCamPos);
        this.vrCardMesh.lookAt(this._tempCamPos);
      }

      // 선택된 핀이 모델과 함께 이동할 경우 카드의 월드 위치도 동기화
      if (this.selectedPin) {
        this.selectedPin.getWorldPosition(this._tempPinPos);
        this.vrCardMesh.position.copy(this._tempPinPos);
        this.vrCardMesh.position.y += 0.24;
      }
    }
  }

  getAllPins() {
    return this.pins.map(p => p.userData);
  }

  /**
   * Three.js 객체 및 하위 자식들의 Geometry, Material 자원을 GPU에서 재귀적으로 해제
   */
  _disposeObject(obj) {
    if (!obj) return;

    if (obj.children && obj.children.length > 0) {
      for (let i = obj.children.length - 1; i >= 0; i--) {
        this._disposeObject(obj.children[i]);
        obj.remove(obj.children[i]);
      }
    }

    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      obj.geometry.dispose();
    }

    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => {
          if (m && typeof m.dispose === 'function') m.dispose();
        });
      } else if (typeof obj.material.dispose === 'function') {
        obj.material.dispose();
      }
    }
  }

  /**
   * 등록된 모든 POI 핀 메쉬 및 GPU 자원을 완전히 해제
   */
  clearPins() {
    while (this.poiGroup.children.length > 0) {
      const obj = this.poiGroup.children[0];
      this._disposeObject(obj);
      this.poiGroup.remove(obj);
    }
    this.pins = [];
    this.hitBoxes = [];
    this._raycastIntersects.length = 0;
    this.selectedPin = null;
    if (this.vrCardMesh) {
      this.vrCardMesh.visible = false;
    }
  }

  /**
   * POIManager 수명 주기 종료 시 모든 WebGL VRAM 및 Canvas 자원 해제
   */
  dispose() {
    this.clearPins();

    if (this.vrCardMesh) {
      this.scene.remove(this.vrCardMesh);
      this._disposeObject(this.vrCardMesh);
      this.vrCardMesh = null;
    }

    if (this.cardCanvasRenderer) {
      this.cardCanvasRenderer.dispose();
      this.cardCanvasRenderer = null;
    }
    this.cardTexture = null;

    if (this.poiGroup) {
      this.scene.remove(this.poiGroup);
      this.poiGroup = null;
    }

    this.camera = null;
    this.renderer = null;
    this.scene = null;
    this.onPOISelect = null;
  }
}
