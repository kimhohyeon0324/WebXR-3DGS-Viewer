import * as THREE from 'three';

/**
 * WebXR 6DoF 직관적 뷰어 인터랙션 관리자
 * - 잡고 이동 & 회전 (그립 버튼): 어느 손이든 그립을 쥐고 손을 움직이면 모델이 그대로 이동 및 회전
 * - 돌리기 (썸스틱 좌/우): 썸스틱을 좌우로 밀어 모델 부드럽게 회전
 * - 줌인/줌아웃 (썸스틱 상/하): 썸스틱을 앞뒤로 밀어 모델 확대/축소 (마우스 휠처럼 직관적)
 * - 양손 핀치 줌 (양손 그립): 두 손을 벌리거나 모아서 크기 조절
 * - 3D POI 핀 피킹 (트리거 클릭): 트리거로 POI 핀 조준 클릭
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
   * @param {Object} [options.splatManager] - 3DGS 스플랫 매니저 참조
   */
  constructor(options = {}) {
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.cameraRig = options.cameraRig;
    this.scene = options.scene;
    this.controllers = options.controllers || [];
    this.targetScene = options.targetScene || options.scene;
    this.poiManager = options.poiManager || null;
    this.splatManager = options.splatManager || null;

    this.active = false;

    // 모델 트랜스폼 상태 (3DGS 스플랫 및 POI 핀 공통 적용)
    this.modelPosition = new THREE.Vector3(0, 0, 0);
    this.modelRotationY = 0;
    this.modelScale = 1.0;

    // 조작 파라미터
    this.minScale = 0.1;
    this.maxScale = 6.0;
    this.zoomSpeed = 1.2; // 썸스틱 줌 속도
    this.rotateSpeed = 2.0; // 썸스틱 회전 속도 (rad/s)
    this.deadzone = 0.15; // 썸스틱 데드존

    // 잡기(Grab) 인터랙션 상태
    this.activeGrabController = null; // 현재 잡기를 수행 중인 컨트롤러
    this.grabStartControllerPos = new THREE.Vector3();
    this.grabStartModelPos = new THREE.Vector3();
    this.grabStartControllerYaw = 0;
    this.grabStartModelRotY = 0;

    // 양손 핀치(Two-Hand Pinch) 상태
    this.isTwoHandPinching = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsAngle = 0;
    this.initialHandsRotY = 0;

    // 임시 연산용 벡터 (GC 방지)
    this._leftPos = new THREE.Vector3();
    this._rightPos = new THREE.Vector3();
    this._currCtrlPos = new THREE.Vector3();
    this._deltaPos = new THREE.Vector3();
    this._tempCamPos = new THREE.Vector3();
    this._tempCamDir = new THREE.Vector3();
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();
    this._controllerEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.bindControllerEvents();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
  }

  setSplatManager(splatManager) {
    this.splatManager = splatManager;
  }

  /**
   * 컨트롤러 이벤트 바인딩 (트리거 클릭은 오직 POI 피킹만 전담)
   */
  bindControllerEvents() {
    // 오른손 트리거: POI 피킹
    const rightController = this.controllers[0];
    if (rightController) {
      rightController.addEventListener('selectstart', () => {
        if (!this.active || !this.poiManager) return;

        rightController.getWorldPosition(this._tempRayOrigin);
        rightController.getWorldDirection(this._tempRayDirection);
        this._tempRayDirection.negate();
        this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
      });
    }

    // 왼손 트리거도 동일하게 POI 피킹 지원
    const leftController = this.controllers[1];
    if (leftController) {
      leftController.addEventListener('selectstart', () => {
        if (!this.active || !this.poiManager) return;

        leftController.getWorldPosition(this._tempRayOrigin);
        leftController.getWorldDirection(this._tempRayDirection);
        this._tempRayDirection.negate();
        this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
      });
    }
  }

  /**
   * VR 진입 시 사용자의 현재 정면 눈높이 위치로 모델 초기 배치
   */
  initViewPosition() {
    if (!this.camera) return;

    this.camera.getWorldPosition(this._tempCamPos);
    this.camera.getWorldDirection(this._tempCamDir);

    this._tempCamDir.y = 0;
    if (this._tempCamDir.lengthSq() < 0.001) {
      this._tempCamDir.set(0, 0, -1);
    } else {
      this._tempCamDir.normalize();
    }

    // 시선 정면 1.3m, 눈높이 살짝 아래(-0.2m)에 편안하게 배치
    this.modelPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, 1.3);
    this.modelPosition.y = Math.max(0.4, this._tempCamPos.y - 0.2);
    this.modelRotationY = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.modelScale = 1.0;

    this.applyTransform();
  }

  /**
   * 모델 트랜스폼 적용 (splatMesh 및 poiGroup)
   */
  applyTransform() {
    const splatMesh = this.splatManager?.getSplatMesh();
    if (splatMesh) {
      splatMesh.position.copy(this.modelPosition);
      splatMesh.rotation.y = this.modelRotationY;
      splatMesh.scale.setScalar(this.modelScale);
    } else if (this.targetScene) {
      this.targetScene.position.copy(this.modelPosition);
      this.targetScene.rotation.y = this.modelRotationY;
      this.targetScene.scale.setScalar(this.modelScale);
    }

    if (this.poiManager && this.poiManager.poiGroup) {
      this.poiManager.poiGroup.position.copy(this.modelPosition);
      this.poiManager.poiGroup.rotation.y = this.modelRotationY;
      this.poiManager.poiGroup.scale.setScalar(this.modelScale);
    }
  }

  activate() {
    this.active = true;
    this.activeGrabController = null;
    this.isTwoHandPinching = false;

    setTimeout(() => {
      this.initViewPosition();
    }, 200);
  }

  deactivate() {
    this.active = false;
    this.activeGrabController = null;
    this.isTwoHandPinching = false;
  }

  /**
   * 매 프레임 인터랙션 루프
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

    const leftGrip = !!(leftGamepad?.buttons[1]?.pressed);
    const rightGrip = !!(rightGamepad?.buttons[1]?.pressed);

    const rightController = this.controllers[0];
    const leftController = this.controllers[1];

    // ==========================================
    // 1. 그립(Grip) 조작: 잡고 이동 및 줌/회전
    // ==========================================
    // A) 양손 그립 동시 누름: 양손 핀치 줌 & 회전
    if (leftGrip && rightGrip && leftController && rightController) {
      this.activeGrabController = null;
      this.handleTwoHandPinch(leftController, rightController);
    }
    // B) 한 손 그립 누름: 잡고 이동 및 손목 회전 (오른손 또는 왼손)
    else if (rightGrip && rightController) {
      this.isTwoHandPinching = false;
      this.handleOneHandGrab(rightController);
    } else if (leftGrip && leftController) {
      this.isTwoHandPinching = false;
      this.handleOneHandGrab(leftController);
    }
    // C) 그립을 모두 놓았을 때: 잡기 상태 초기화
    else {
      this.activeGrabController = null;
      this.isTwoHandPinching = false;
    }

    // ==========================================
    // 2. 썸스틱 조작: 돌리기(좌우) & 줌인아웃(앞뒤)
    // ==========================================
    const activeStick = (rightGamepad && rightGamepad.axes.length >= 4) ? rightGamepad :
                        (leftGamepad && leftGamepad.axes.length >= 4) ? leftGamepad : null;

    if (activeStick && !this.activeGrabController && !this.isTwoHandPinching) {
      this.handleThumbstick(activeStick, delta);
    }
  }

  /**
   * 한 손 잡기: 손의 움직임대로 모델 이동 및 손목 각도대로 회전
   */
  handleOneHandGrab(controller) {
    controller.getWorldPosition(this._currCtrlPos);
    this._controllerEuler.setFromQuaternion(controller.quaternion, 'YXZ');
    const currentYaw = this._controllerEuler.y;

    if (this.activeGrabController !== controller) {
      this.activeGrabController = controller;
      this.grabStartControllerPos.copy(this._currCtrlPos);
      this.grabStartModelPos.copy(this.modelPosition);
      this.grabStartControllerYaw = currentYaw;
      this.grabStartModelRotY = this.modelRotationY;
    } else {
      // 위치 이동 (손이 움직인 만큼 모델 이동)
      this._deltaPos.copy(this._currCtrlPos).sub(this.grabStartControllerPos);
      this.modelPosition.copy(this.grabStartModelPos).add(this._deltaPos);

      // 손목 회전 (손목 각도가 틀어진 만큼 모델 회전)
      const deltaYaw = currentYaw - this.grabStartControllerYaw;
      this.modelRotationY = this.grabStartModelRotY + deltaYaw;

      this.applyTransform();
    }
  }

  /**
   * 양손 핀치: 두 손 사이 거리로 확대/축소 및 회전
   */
  handleTwoHandPinch(leftController, rightController) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);

    const currentDistance = this._leftPos.distanceTo(this._rightPos);
    const currentAngle = Math.atan2(this._rightPos.x - this._leftPos.x, this._rightPos.z - this._leftPos.z);

    if (!this.isTwoHandPinching) {
      this.isTwoHandPinching = true;
      this.initialHandsDistance = currentDistance;
      this.initialModelScale = this.modelScale;
      this.initialHandsAngle = currentAngle;
      this.initialHandsRotY = this.modelRotationY;
    } else {
      // 거리 비율로 스케일 조절
      if (this.initialHandsDistance > 0.05) {
        const ratio = currentDistance / this.initialHandsDistance;
        this.modelScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * ratio));
      }

      // 두 손을 잇는 축의 회전
      const deltaAngle = currentAngle - this.initialHandsAngle;
      this.modelRotationY = this.initialHandsRotY + deltaAngle;

      this.applyTransform();
    }
  }

  /**
   * 썸스틱 조작:
   * - 좌/우 (axes[2]): 모델 부드럽게 회전
   * - 앞/뒤 (axes[3]): 모델 줌인 / 줌아웃 (마우스 휠 방식)
   */
  handleThumbstick(gamepad, delta) {
    const axes = gamepad.axes;
    const stickX = axes[2];
    const stickY = axes[3];

    let needUpdate = false;

    // 1) 좌우 썸스틱 -> 모델 부드러운 회전
    if (Math.abs(stickX) > this.deadzone) {
      this.modelRotationY -= stickX * this.rotateSpeed * delta;
      needUpdate = true;
    }

    // 2) 앞뒤 썸스틱 -> 줌인(앞으로 밀기) / 줌아웃(뒤로 당기기)
    if (Math.abs(stickY) > this.deadzone) {
      const zoomFactor = 1.0 - stickY * this.zoomSpeed * delta;
      this.modelScale = Math.max(this.minScale, Math.min(this.maxScale, this.modelScale * zoomFactor));
      needUpdate = true;
    }

    if (needUpdate) {
      this.applyTransform();
    }
  }
}
