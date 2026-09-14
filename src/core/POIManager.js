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

    // VR 공간 전용 3D 플로팅 정보 카드 메쉬
    this.vrCardMesh = this.createVRCardMesh();
    this.scene.add(this.vrCardMesh);

    this.initDefaultPins();
  }

  /**
   * VR 세션 내에 텍스트와 메타데이터를 표시할 3D Canvas 텍스처 패널 생성
   */
  createVRCardMesh() {
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 512;
    this.cardCanvas.height = 256;
    this.cardCtx = this.cardCanvas.getContext('2d');

    this.cardTexture = new THREE.CanvasTexture(this.cardCanvas);
    this.cardTexture.minFilter = THREE.LinearFilter;
    this.cardTexture.magFilter = THREE.LinearFilter;

    // 가로 0.42m, 세로 0.21m의 컴팩트한 평면
    const geometry = new THREE.PlaneGeometry(0.42, 0.21);
    const material = new THREE.MeshBasicMaterial({
      map: this.cardTexture,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'VR_POI_InfoCard';
    mesh.visible = false;
    mesh.renderOrder = 30; // 핀보다 상위에 렌더링
    return mesh;
  }

  /**
   * 2D Canvas에 POI 메타데이터 렌더링 후 텍스처 갱신
   */
  updateVRCardTexture(poiData) {
    if (!this.cardCtx) return;
    const ctx = this.cardCtx;
    const w = 512;
    const h = 256;

    ctx.clearRect(0, 0, w, h);

    // 1. 반투명 글래스모피즘 배경
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    this._roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();

    // 2. 테두리 네온 라인
    const isHaptic = poiData.type === 'haptic';
    ctx.strokeStyle = isHaptic ? 'rgba(245, 158, 11, 0.9)' : 'rgba(0, 240, 255, 0.9)';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.stroke();

    // 3. 타입 뱃지
    const badgeColor = isHaptic ? '#f59e0b' : '#00f0ff';
    ctx.fillStyle = badgeColor;
    this._roundRect(ctx, 24, 22, isHaptic ? 90 : 80, 28, 6);
    ctx.fill();

    ctx.fillStyle = '#0a0e17';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((poiData.type || 'POI').toUpperCase(), isHaptic ? 69 : 64, 36);

    // 4. 타이틀
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(poiData.title || 'POI Metadata', 120, 36);

    // 5. 구분선
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24, 62);
    ctx.lineTo(w - 24, 62);
    ctx.stroke();

    // 6. 3D 좌표 정보
    const coordStr = poiData.coordinates
      ? `(${poiData.coordinates.x.toFixed(3)}, ${poiData.coordinates.y.toFixed(3)}, ${poiData.coordinates.z.toFixed(3)})`
      : 'N/A';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText(`3D POS: ${coordStr}`, 24, 84);

    // 7. 설명문 본문 (자동 줄바꿈)
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '16px sans-serif';
    this._wrapText(ctx, poiData.description || '', 24, 116, w - 48, 24);

    this.cardTexture.needsUpdate = true;
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    let line = '';
    let currentY = y;
    for (let i = 0; i < text.length; i++) {
      const testLine = line + text[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = text[i];
        currentY += lineHeight;
        if (currentY > 230) {
          ctx.fillText(line + '...', x, currentY);
          return;
        }
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
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

  /**
   * 레이저가 POI 핀을 조준하고 있는지 비파괴 검사 (Hover 감지용)
   */
  checkRayHover(origin, direction) {
    this.raycaster.set(origin, direction);
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
      return intersects[0].object.userData.pinRef || null;
    }
    return null;
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
    if (this.selectedPin === pin && this.vrCardMesh.visible) {
      // 이미 선택된 핀을 다시 클릭하면 VR 카드 닫기 토글
      this.selectedPin = null;
      this.vrCardMesh.visible = false;
      console.log(`POIManager: 핀 선택 해제 -> ${pin.userData.title}`);
      return;
    }

    this.selectedPin = pin;
    this.updateVRCardTexture(pin.userData);

    // VR 카드를 핀 상단 0.22m 위치에 배치
    const pinWorldPos = new THREE.Vector3();
    pin.getWorldPosition(pinWorldPos);
    this.vrCardMesh.position.copy(pinWorldPos);
    this.vrCardMesh.position.y += 0.22;
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

    // VR 플로팅 카드 빌보드(항상 사용자의 시선 카메라를 정면으로 바라봄)
    if (this.vrCardMesh && this.vrCardMesh.visible && this.camera) {
      this.vrCardMesh.lookAt(this.camera.position);

      // 선택된 핀이 모델과 함께 이동할 경우 카드의 월드 위치도 동기화
      if (this.selectedPin) {
        const pinWorldPos = new THREE.Vector3();
        this.selectedPin.getWorldPosition(pinWorldPos);
        this.vrCardMesh.position.copy(pinWorldPos);
        this.vrCardMesh.position.y += 0.22;
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
    if (this.vrCardMesh) {
      this.vrCardMesh.visible = false;
    }
  }
}
