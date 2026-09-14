import * as THREE from 'three';

/**
 * WebXR 6DoF 직관적 뷰어 인터랙션 관리자 (트리거 단독 조작계)
 * - 한 손 트리거: 오브젝트를 잡고 손의 움직임에 따라 1:1로 이동 및 오브젝트 중심 회전
 * - 양손 트리거: 두 손 사이 거리를 벌리거나 좁혀 줌인/줌아웃(스케일) 및 양손 축 회전
 * - 트리거 클릭(단발 피킹): 3D POI 핀을 조준하고 누르면 VR 세션 내 3D 정보 카드 토글
 * - 썸스틱 및 그립 버튼 인터랙션 완전 제거
 * - 회전 및 확대/축소 피벗 축: 월드 원점이 아닌 오브젝트 로컬 중심
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

    // 모델 트랜스폼 상태 (오브젝트 로컬 중심 피벗 유지)
    this.modelPosition = new THREE.Vector3(0, 0, 0);
    this.modelQuaternion = new THREE.Quaternion();
    this.modelScale = 1.0;

    // 조작 파라미터
    this.minScale = 0.1;
    this.maxScale = 6.0;

    // 잡기(Grab) 상태 추적
    this.activeGrabController = null;
    this.grabStartControllerPos = new THREE.Vector3();
    this.grabStartControllerQuat = new THREE.Quaternion();
    this.grabStartModelPos = new THREE.Vector3();
    this.grabStartModelQuat = new THREE.Quaternion();

    // 양손 줌/회전/이동 상태 추적
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsVec = new THREE.Vector3();
    this.initialMidpoint = new THREE.Vector3();
    this.initialModelPos = new THREE.Vector3();
    this.initialModelQuat = new THREE.Quaternion();

    // 임시 연산용 객체 (GC 방지)
    this._leftPos = new THREE.Vector3();
    this._rightPos = new THREE.Vector3();
    this._currMidpoint = new THREE.Vector3();
    this._currHandsVec = new THREE.Vector3();
    this._deltaMidpoint = new THREE.Vector3();
    this._u0 = new THREE.Vector3();
    this._u1 = new THREE.Vector3();
    this._currCtrlPos = new THREE.Vector3();
    this._currCtrlQuat = new THREE.Quaternion();
    this._deltaPos = new THREE.Vector3();
    this._deltaQuat = new THREE.Quaternion();
    this._invStartQuat = new THREE.Quaternion();
    this._tempCamPos = new THREE.Vector3();
    this._tempCamDir = new THREE.Vector3();
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();

    this.bindControllerEvents();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
  }

  setSplatManager(splatManager) {
    this.splatManager = splatManager;
  }

  /**
   * 컨트롤러 이벤트 바인딩
   * 1) POI 핀 피킹 검사 (핀 조준 시 VR 카드 토글)
   * 2) 트리거 잡기(Grab) 시작 및 종료 즉시 감지 (selectstart / selectend)
   */
  bindControllerEvents() {
    this.controllers.forEach((controller) => {
      if (!controller) return;

      controller.addEventListener('selectstart', () => {
        if (!this.active) return;

        // 1. POI 핀 레이저 피킹 우선 확인
        if (this.poiManager) {
          controller.getWorldPosition(this._tempRayOrigin);
          controller.getWorldDirection(this._tempRayDirection);
          this._tempRayDirection.negate();
          const pickedPOI = this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
          if (pickedPOI) {
            // 핀을 클릭한 경우 잡기 조작으로 전이되지 않도록 플래그 설정 후 리턴
            controller.userData.isPickingPOI = true;
            return;
          }
        }

        // 2. 핀이 아니라면 즉시 오브젝트 잡기 시작
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = true;
      });

      controller.addEventListener('selectend', () => {
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = false;
        if (this.activeGrabController === controller) {
          this.activeGrabController = null;
        }
      });
    });
  }

  /**
   * VR 진입 시 사용자의 정면 눈높이 위치로 모델 초기 배치
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

    const yaw = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.modelQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.modelScale = 1.0;

    this.applyTransform();
  }

  /**
   * 모델 트랜스폼 적용 (오브젝트 자체의 중심을 기준으로 회전/스케일 적용)
   */
  applyTransform() {
    const splatMesh = this.splatManager?.getSplatMesh();
    if (splatMesh) {
      splatMesh.position.copy(this.modelPosition);
      splatMesh.quaternion.copy(this.modelQuaternion);
      splatMesh.scale.setScalar(this.modelScale);
    } else if (this.targetScene) {
      this.targetScene.position.copy(this.modelPosition);
      this.targetScene.quaternion.copy(this.modelQuaternion);
      this.targetScene.scale.setScalar(this.modelScale);
    }

    if (this.poiManager && this.poiManager.poiGroup) {
      this.poiManager.poiGroup.position.copy(this.modelPosition);
      this.poiManager.poiGroup.quaternion.copy(this.modelQuaternion);
      this.poiManager.poiGroup.scale.setScalar(this.modelScale);
    }
  }

  activate() {
    this.active = true;
    this.activeGrabController = null;
    this.isTwoHandGrabbing = false;

    setTimeout(() => {
      this.initViewPosition();
    }, 200);
  }

  deactivate() {
    this.active = false;
    this.activeGrabController = null;
    this.isTwoHandGrabbing = false;
  }

  /**
   * 매 프레임 인터랙션 루프
   * 이벤트 상태(isTriggerHeld)와 WebXR 게임패드 상태를 이중 감지하여 100% 신뢰성 보장
   */
  update(delta = 0.016) {
    if (!this.active) return;

    const session = this.renderer?.xr?.getSession();

    let leftController = null;
    let rightController = null;
    let leftTrigger = false;
    let rightTrigger = false;

    for (let i = 0; i < this.controllers.length; i++) {
      const ctrl = this.controllers[i];
      const handedness = ctrl.userData?.handedness || (i === 0 ? 'right' : 'left');

      // 1) selectstart/selectend 이벤트 기반 트리거 상태
      const eventHeld = !!ctrl.userData?.isTriggerHeld;

      // 2) WebXR gamepad 폴링 기반 트리거 상태 (POI 피킹 중이 아닐 때만 유효)
      let gamepadPressed = false;
      if (!ctrl.userData?.isPickingPOI) {
        const gamepad = ctrl.userData?.inputSource?.gamepad ||
          (session?.inputSources ? Array.from(session.inputSources).find(s => s?.handedness === handedness)?.gamepad : null);
        if (gamepad?.buttons[0]) {
          gamepadPressed = gamepad.buttons[0].pressed || gamepad.buttons[0].value > 0.15;
        }
      }

      const isPressed = eventHeld || gamepadPressed;

      if (handedness === 'left') {
        leftController = ctrl;
        leftTrigger = isPressed;
      } else if (handedness === 'right') {
        rightController = ctrl;
        rightTrigger = isPressed;
      }
    }

    // ==========================================
    // 1. 양손 트리거: 양손으로 잡고 돌리기(회전) & 벌리고 모으기(확대/축소) & 위치 이동
    // ==========================================
    if (leftTrigger && rightTrigger && leftController && rightController) {
      this.activeGrabController = null;
      this.handleTwoHandTransform(leftController, rightController);
    }
    // ==========================================
    // 2. 한 손 트리거: 잡은 손으로 1:1 위치 이동 (손목 회전 간섭 없이 깔끔한 이동)
    // ==========================================
    else if (rightTrigger && rightController) {
      this.isTwoHandGrabbing = false;
      this.handleOneHandGrab(rightController);
    } else if (leftTrigger && leftController) {
      this.isTwoHandGrabbing = false;
      this.handleOneHandGrab(leftController);
    }
    // ==========================================
    // 3. 트리거를 모두 놓았을 때: 상태 리셋
    // ==========================================
    else {
      this.activeGrabController = null;
      this.isTwoHandGrabbing = false;
    }
  }

  /**
   * 한 손 잡기: 손의 움직임에 따라 모델을 1:1로 이동 (위치 변경 전담)
   */
  handleOneHandGrab(controller) {
    controller.getWorldPosition(this._currCtrlPos);

    if (this.activeGrabController !== controller) {
      this.activeGrabController = controller;
      this.grabStartControllerPos.copy(this._currCtrlPos);
      this.grabStartModelPos.copy(this.modelPosition);
    } else {
      // 손이 이동한 델타만큼 모델의 위치를 1:1 이동
      this._deltaPos.copy(this._currCtrlPos).sub(this.grabStartControllerPos);
      this.modelPosition.copy(this.grabStartModelPos).add(this._deltaPos);

      this.applyTransform();
    }
  }

  /**
   * 양손 잡기: 두 손으로 잡고 돌리기(오브젝트 중심 회전) & 벌리고 모으기(오브젝트 중심 줌인/줌아웃) & 이동(두 손 중심점 추종)
   */
  handleTwoHandTransform(leftController, rightController) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);

    // 두 손의 중점 및 두 손을 잇는 방향 벡터 계산
    this._currMidpoint.addVectors(this._leftPos, this._rightPos).multiplyScalar(0.5);
    this._currHandsVec.subVectors(this._rightPos, this._leftPos);
    const currentDistance = this._currHandsVec.length();

    if (!this.isTwoHandGrabbing) {
      this.isTwoHandGrabbing = true;
      this.initialHandsDistance = Math.max(0.05, currentDistance);
      this.initialModelScale = this.modelScale;
      this.initialHandsVec.copy(this._currHandsVec);
      this.initialMidpoint.copy(this._currMidpoint);
      this.initialModelQuat.copy(this.modelQuaternion);
      this.initialModelPos.copy(this.modelPosition);
    } else {
      if (this.initialHandsDistance > 0.05 && currentDistance > 0.02) {
        // 1. 확대 / 축소 (두 손 사이 거리 비율에 맞춰 오브젝트 로컬 중심 기준 확대/축소)
        const scaleRatio = currentDistance / this.initialHandsDistance;
        this.modelScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * scaleRatio));

        // 2. 양손 회전 (두 손이 이루는 방향 축의 3D 회전 변화량에 맞춰 오브젝트 로컬 중심 기준 회전)
        this._u0.copy(this.initialHandsVec).normalize();
        this._u1.copy(this._currHandsVec).normalize();
        this._deltaQuat.setFromUnitVectors(this._u0, this._u1);
        this.modelQuaternion.multiplyQuaternions(this._deltaQuat, this.initialModelQuat);

        // 3. 위치 이동 (두 손의 중심점이 이동한 델타만큼 모델 위치 1:1 이동)
        this._deltaMidpoint.subVectors(this._currMidpoint, this.initialMidpoint);
        this.modelPosition.addVectors(this.initialModelPos, this._deltaMidpoint);

        this.applyTransform();
      }
    }
  }
}
