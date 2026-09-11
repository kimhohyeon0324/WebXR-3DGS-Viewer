import * as THREE from 'three';

/**
 * 3D POI(Point of Interest) 메타데이터 핀 관리자
 * 3DGS 씬 내부의 시공간 메타데이터 핀 배치, 애니메이션, 레이캐스팅 피킹
 */
export class POIManager {
  /**
   * @param {Object} options
   * @param {THREE.Scene} options.scene - 가상 Three.js 씬
   * @param {THREE.PerspectiveCamera} options.camera - 카메라
   * @param {Function} [options.onPOISelect] - 핀 선택 콜백
   */
  constructor(options = {}) {
    this.scene = options.scene;
    this.camera = options.camera;
    this.onPOISelect = options.onPOISelect || (() => {});

    this.poiGroup = new THREE.Group();
    this.poiGroup.name = 'POIGroup';
    this.scene.add(this.poiGroup);

    this.pins = [];
    this.selectedPin = null;

    this.raycaster = new THREE.Raycaster();

    this.initDefaultPins();
  }

  /**
   * 분재 씬 좌표계에 정합된 기본 프리셋 핀 로드
   */
  initDefaultPins() {
    this.loadPreset('bonsai');
  }

  /**
   * 프리셋 모델별 전용 POI 핀 로드
   */
  loadPreset(presetKey) {
    this.clearPins();

    if (presetKey === 'bonsai') {
      this.addPOI({
        id: 'poi-bonsai-audio',
        title: 'Bonsai 상단 벚꽃 잎 (공간 오디오)',
        type: 'audio',
        // 미세 교정 후 상단 벚꽃 꼭대기 표면 (0.274, 1.491, 0.114) 바로 위 4mm
        coordinates: new THREE.Vector3(0.274, 1.495, 0.114),
        description: '가지와 잎사귀의 미세한 바람 소리를 재현하는 3D 공간 음향(Spatial Audio) 앵커 포인트입니다. Meta Quest 3D 오디오 렌더러와 동기화됩니다.'
      });

      this.addPOI({
        id: 'poi-bonsai-haptic',
        title: '화분 조약돌 (햅틱 진동 피드백)',
        type: 'haptic',
        // 화분 전면 테두리(1.171m) 위로 띄워 시야를 확보한 직상방 앵커 (0.041, 1.185, 0.088)
        coordinates: new THREE.Vector3(0.041, 1.185, 0.088),
        description: '화분 표면 및 거친 나무 껍질의 질감을 표현하는 햅틱 진동 패턴(Haptic Feedback Pulse) 메타데이터가 바인딩된 지점입니다.'
      });
    } else if (presetKey === 'dragon') {
      this.addPOI({
        id: 'poi-dragon-head',
        title: '골든 드래곤 붉은 뿔 (공간 오디오)',
        type: 'audio',
        // 실측 붉은 뿔 최상단 표면 (-0.116, 1.662, 0.074) 바로 위 3mm 정밀 타겟
        coordinates: new THREE.Vector3(-0.116, 1.665, 0.074),
        description: '황금 용의 머리와 붉은 뿔 부위에서 울려 퍼지는 중후한 용의 숨결 3D 공간 오디오 포인트입니다.'
      });

      this.addPOI({
        id: 'poi-dragon-body',
        title: '황금 비늘 및 가슴 (햅틱 진동 피드백)',
        type: 'haptic',
        // 앞발/가슴 가장 앞쪽 바깥 표면 (X: 0.390, Y: 0.776, Z: 0.439) 바로 위 정밀 타겟
        coordinates: new THREE.Vector3(0.385, 0.780, 0.445),
        description: '용의 거친 황금 비늘 질감과 심장 박동을 모사하는 햅틱 진동 패턴 메타데이터 앵커입니다.'
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

    const typeColor = data.type === 'haptic' ? 0xf59e0b : 0x00f0ff;

    // 1) 포인터 원뿔 (꼭짓점이 정확히 로컬 Y = 0.00에 위치하도록 피벗 정렬)
    const coneHeight = 0.060; // 6cm 날렵한 높이
    const coneRadius = 0.022; // 2.2cm 컴팩트 반경
    const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 20);
    // 꼭짓점이 아래로 향하게 180도 회전
    coneGeo.rotateX(Math.PI);
    // 꼭짓점이 로컬 원점 (0, 0, 0)에 닿도록 위로 평행이동
    coneGeo.translate(0, coneHeight / 2, 0);

    const coneMat = new THREE.MeshStandardMaterial({
      color: typeColor,
      emissive: typeColor,
      emissiveIntensity: 0.85,
      roughness: 0.15,
      metalness: 0.85,
      depthTest: true
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.name = 'cone';
    pin.add(cone);

    // 2) 원뿔 상단에 얹힌 발광 화이트 코어 구체
    const sphereRadius = 0.014;
    const sphereGeo = new THREE.SphereGeometry(sphereRadius, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.y = coneHeight + sphereRadius * 0.7;
    sphere.name = 'sphere';
    pin.add(sphere);

    // 3) 수평 펄스 링 (원뿔 중간 높이에 배치하여 표면 간섭 방지)
    const ringGeo = new THREE.RingGeometry(0.018, 0.032, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: typeColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.80,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025; // 표면에서 2.5cm 위
    ring.name = 'ring';
    pin.add(ring);

    // 4) 충돌 판정용 비가시 구체 (피킹용)
    const hitGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitBox = new THREE.Mesh(hitGeo, hitMat);
    hitBox.position.y = coneHeight / 2;
    hitBox.userData = { isPOIHitBox: true, pinRef: pin };
    pin.add(hitBox);

    // 렌더링 우선순위 부여
    pin.renderOrder = 20;
    cone.renderOrder = 21;
    sphere.renderOrder = 22;
    ring.renderOrder = 20;

    this.poiGroup.add(pin);
    this.pins.push(pin);

    return pin;
  }

  pickWithPointer(mouseX, mouseY, camera) {
    this.raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera);
    return this._checkIntersections();
  }

  pickWithRay(origin, direction) {
    this.raycaster.set(origin, direction);
    return this._checkIntersections();
  }

  _checkIntersections() {
    const hitBoxes = [];
    for (const pin of this.pins) {
      for (const child of pin.children) {
        if (child.userData?.isPOIHitBox) {
          hitBoxes.push(child);
        }
      }
    }

    const intersects = this.raycaster.intersectObjects(hitBoxes, false);
    if (intersects.length > 0) {
      const hitBox = intersects[0].object;
      const pin = hitBox.userData.pinRef;
      if (pin && pin.userData) {
        this.selectPin(pin);
        return pin.userData;
      }
    }
    return null;
  }

  selectPin(pin) {
    this.selectedPin = pin;
    this.onPOISelect(pin.userData);
    console.log(`POIManager: 핀 선택됨 -> ${pin.userData.title}`);
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
  }

  getAllPins() {
    return this.pins.map(p => p.userData);
  }

  clearPins() {
    while (this.poiGroup.children.length > 0) {
      const obj = this.poiGroup.children[0];
      this.poiGroup.remove(obj);
    }
    this.pins = [];
    this.selectedPin = null;
  }
}
