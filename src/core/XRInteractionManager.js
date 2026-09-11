import * as THREE from 'three';

/**
 * WebXR 6DoF 인터랙션 관리자
 * - 지면 레이캐스팅 텔레포트 (오른손 트리거 길게 누름)
 * - 3D POI 핀 레이저 피킹 (오른손 트리거 클릭)
 * - 부드러운 이동 (왼손 썸스틱)
 * - 45도 스냅 회전 (오른손 썸스틱)
 * - 양손 그립 씬 스케일 및 회전 조작
 */
export class XRInteractionManager {
  /**
   * @param {Object} options
   * @param {THREE.WebGLRenderer} options.renderer
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {THREE.Group} options.cameraRig
   * @param {THREE.Scene} options.scene
   * @param {Array<THREE.XRTargetRaySpace>} options.controllers
   * @param {THREE.Object3D} [options.targetScene] - 조작 대상 씬
   * @param {Object} [options.poiManager] - POI 관리자 참조
   */
  constructor(options = {}) {
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.cameraRig = options.cameraRig;
    this.scene = options.scene;
    this.controllers = options.controllers || [];
    this.targetScene = options.targetScene || options.scene;
    this.poiManager = options.poiManager || null;

    this.active = false;

    // 이동 및 회전 파라미터
    this.moveSpeed = 1.8; // m/s
    this.snapAngle = THREE.MathUtils.degToRad(45); // 45도
    this.snapCooldown = 0.35; // 초 단위 쿨다운
    this.lastSnapTime = 0;
    this.deadzone = 0.15;

    // 텔레포트 및 피킹 상태
    this.isTeleportAiming = false;
    this.teleportTarget = new THREE.Vector3();
    this.teleportValid = false;
    this.selectStartTime = 0;

    // 양손 그립 제스처 상태
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialSceneScale = new THREE.Vector3(1, 1, 1);
    this.initialHandsAngle = 0;
    this.initialSceneRotationY = 0;

    // 임시 연산용 벡터
    this._moveDirection = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();

    // 텔레포트 시각화 마커 생성
    this.createTeleportMarker();

    // 이벤트 바인딩
    this.bindControllerEvents();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
  }

  /**
   * 텔레포트 바닥 링 마커 생성
   */
  createTeleportMarker() {
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'TeleportMarker';
    this.markerGroup.visible = false;

    // 바깥쪽 링 (네온 시안)
    const ringGeo = new THREE.RingGeometry(0.3, 0.36, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    this.markerGroup.add(ring);

    // 안쪽 발광 원판
    const innerGeo = new THREE.CircleGeometry(0.12, 24);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.rotation.x = -Math.PI / 2;
    this.markerGroup.add(inner);

    this.markerGroup.position.y = 0.01;
    this.scene.add(this.markerGroup);
  }

  /**
   * 컨트롤러 버튼 이벤트 리스너 등록
   */
  bindControllerEvents() {
    const rightController = this.controllers[0];
    if (rightController) {
      rightController.addEventListener('selectstart', () => {
        if (!this.active) return;
        this.selectStartTime = performance.now();

        // 1) POI 핀 피킹 우선 검사
        if (this.poiManager) {
          rightController.getWorldPosition(this._tempRayOrigin);
          rightController.getWorldDirection(this._tempRayDirection);
          this._tempRayDirection.negate();
          const pickedPOI = this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
          if (pickedPOI) {
            console.log('XRInteraction: VR 컨트롤러로 POI 핀 선택 완료');
            return;
          }
        }

        // 2) 핀 피킹이 아닐 경우 바닥 텔레포트 조준 활성화
        this.isTeleportAiming = true;
      });

      rightController.addEventListener('selectend', () => {
        if (!this.active) return;

        if (this.isTeleportAiming && this.teleportValid) {
          this.executeTeleport();
        }

        this.isTeleportAiming = false;
        if (this.markerGroup) this.markerGroup.visible = false;
      });
    }
  }

  /**
   * 텔레포트 실행
   */
  executeTeleport() {
    if (!this.cameraRig) return;
    this.cameraRig.position.x = this.teleportTarget.x;
    this.cameraRig.position.z = this.teleportTarget.z;
    console.log(`XRInteraction: 텔레포트 이동 완료 -> (${this.teleportTarget.x.toFixed(2)}, ${this.teleportTarget.z.toFixed(2)})`);
  }

  activate() {
    this.active = true;
    if (this.markerGroup) this.markerGroup.visible = false;
  }

  deactivate() {
    this.active = false;
    this.isTeleportAiming = false;
    this.isTwoHandGrabbing = false;
    if (this.markerGroup) this.markerGroup.visible = false;
  }

  /**
   * 매 프레임 인터랙션 갱신 (WebXR 렌더 루프에서 호출)
   */
  update(delta = 0.016) {
    if (!this.active) return;

    const session = this.renderer?.xr?.getSession();
    if (!session) return;

    let leftGamepad = null;
    let rightGamepad = null;

    for (const source of session.inputSources) {
      if (source && source.gamepad) {
        if (source.handedness === 'left') leftGamepad = source.gamepad;
        else if (source.handedness === 'right') rightGamepad = source.gamepad;
      }
    }

    // 1) 텔레포트 지면 레이캐스트 갱신
    this.updateTeleportRaycast();

    // 2) 왼손 썸스틱 부드러운 이동
    if (leftGamepad) {
      this.handleSmoothLocomotion(leftGamepad, delta);
    }

    // 3) 오른손 썸스틱 45도 스냅 회전
    if (rightGamepad) {
      this.handleSnapTurn(rightGamepad);
    }

    // 4) 양손 그립 씬 스케일/회전 조작
    if (leftGamepad && rightGamepad) {
      this.handleTwoHandedManipulation(leftGamepad, rightGamepad);
    }
  }

  updateTeleportRaycast() {
    if (!this.isTeleportAiming) {
      if (this.markerGroup) this.markerGroup.visible = false;
      return;
    }

    const rightController = this.controllers[0];
    if (!rightController) return;

    rightController.getWorldPosition(this._tempRayOrigin);
    rightController.getWorldDirection(this._tempRayDirection);
    this._tempRayDirection.negate();

    if (this._tempRayDirection.y < -0.05) {
      const t = -this._tempRayOrigin.y / this._tempRayDirection.y;
      if (t > 0 && t < 25) {
        this.teleportTarget.x = this._tempRayOrigin.x + this._tempRayDirection.x * t;
        this.teleportTarget.y = 0.01;
        this.teleportTarget.z = this._tempRayOrigin.z + this._tempRayDirection.z * t;

        this.teleportValid = true;
        if (this.markerGroup) {
          this.markerGroup.position.copy(this.teleportTarget);
          this.markerGroup.visible = true;
        }
        return;
      }
    }

    this.teleportValid = false;
    if (this.markerGroup) {
      this.markerGroup.visible = false;
    }
  }

  handleSmoothLocomotion(gamepad, delta) {
    if (this.isTwoHandGrabbing) return;

    const axes = gamepad.axes;
    if (!axes || axes.length < 4) return;

    const stickX = axes[2];
    const stickY = axes[3];

    if (Math.abs(stickX) < this.deadzone && Math.abs(stickY) < this.deadzone) {
      return;
    }

    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    this._forward.normalize();

    this._right.crossVectors(this._forward, this.camera.up).normalize();

    this._moveDirection.set(0, 0, 0);
    this._moveDirection.addScaledVector(this._forward, -stickY);
    this._moveDirection.addScaledVector(this._right, stickX);
    this._moveDirection.normalize();

    const distance = this.moveSpeed * delta;
    this.cameraRig.position.addScaledVector(this._moveDirection, distance);
  }

  handleSnapTurn(gamepad) {
    const axes = gamepad.axes;
    if (!axes || axes.length < 4) return;

    const stickX = axes[2];
    const now = performance.now() / 1000;

    if (now - this.lastSnapTime < this.snapCooldown) {
      return;
    }

    if (stickX > 0.65) {
      this.cameraRig.rotation.y -= this.snapAngle;
      this.lastSnapTime = now;
    } else if (stickX < -0.65) {
      this.cameraRig.rotation.y += this.snapAngle;
      this.lastSnapTime = now;
    }
  }

  handleTwoHandedManipulation(leftGamepad, rightGamepad) {
    const leftGrip = leftGamepad.buttons[1]?.pressed;
    const rightGrip = rightGamepad.buttons[1]?.pressed;

    const leftController = this.controllers[1];
    const rightController = this.controllers[0];

    if (!leftController || !rightController) return;

    if (leftGrip && rightGrip) {
      const leftPos = new THREE.Vector3();
      const rightPos = new THREE.Vector3();
      leftController.getWorldPosition(leftPos);
      rightController.getWorldPosition(rightPos);

      const currentDistance = leftPos.distanceTo(rightPos);
      const currentAngle = Math.atan2(rightPos.x - leftPos.x, rightPos.z - leftPos.z);

      if (!this.isTwoHandGrabbing) {
        this.isTwoHandGrabbing = true;
        this.initialHandsDistance = currentDistance;
        this.initialSceneScale.copy(this.targetScene.scale);
        this.initialHandsAngle = currentAngle;
        this.initialSceneRotationY = this.targetScene.rotation.y;
      } else {
        if (this.initialHandsDistance > 0.05) {
          const ratio = currentDistance / this.initialHandsDistance;
          const newScale = Math.max(0.2, Math.min(5.0, this.initialSceneScale.x * ratio));
          this.targetScene.scale.set(newScale, newScale, newScale);
        }

        const deltaAngle = currentAngle - this.initialHandsAngle;
        this.targetScene.rotation.y = this.initialSceneRotationY + deltaAngle;
      }
    } else {
      if (this.isTwoHandGrabbing) {
        this.isTwoHandGrabbing = false;
      }
    }
  }
}
