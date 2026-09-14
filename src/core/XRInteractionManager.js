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

    // 양손 줌/회전 상태 추적
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsAngle = 0;
    this.initialHandsModelQuat = new THREE.Quaternion();

    // 임시 연산용 객체 (GC 방지)
    this._leftPos = new THREE.Vector3();
    this._rightPos = new THREE.Vector3();
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
   * 트리거 누름 시 POI 핀 피킹 먼저 검사 (핀 조준 시 VR 카드 토글)
   */
  bindControllerEvents() {
    this.controllers.forEach((controller) => {
      if (!controller) return;
      controller.addEventListener('selectstart', () => {
        if (!this.active || !this.poiManager) return;

        controller.getWorldPosition(this._tempRayOrigin);
        controller.getWorldDirection(this._tempRayDirection);
        this._tempRayDirection.negate();
        this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
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
   * 오직 트리거(buttons[0])만 사용하여 잡고 이동 & 양손 줌인아웃 수행
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

    // 오직 트리거 버튼(buttons[0])만 판정 (그립 버튼 및 썸스틱 완전 제외)
    const leftTrigger = !!(leftGamepad?.buttons[0]?.pressed);
    const rightTrigger = !!(rightGamepad?.buttons[0]?.pressed);

    const rightController = this.controllers[0];
    const leftController = this.controllers[1];

    // ==========================================
    // 1. 양손 트리거: 줌인/줌아웃(스케일) 및 양손 축 회전
    // ==========================================
    if (leftTrigger && rightTrigger && leftController && rightController) {
      this.activeGrabController = null;
      this.handleTwoHandZoom(leftController, rightController);
    }
    // ==========================================
    // 2. 한 손 트리거: 오브젝트 잡고 이동 & 오브젝트 중심 손목 회전
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
   * 한 손 잡기: 손의 6DoF 이동 및 회전에 맞춰 모델이 1:1로 이동 및 '오브젝트 중심'으로 회전
   */
  handleOneHandGrab(controller) {
    controller.getWorldPosition(this._currCtrlPos);
    controller.getWorldQuaternion(this._currCtrlQuat);

    if (this.activeGrabController !== controller) {
      this.activeGrabController = controller;
      this.grabStartControllerPos.copy(this._currCtrlPos);
      this.grabStartControllerQuat.copy(this._currCtrlQuat);
      this.grabStartModelPos.copy(this.modelPosition);
      this.grabStartModelQuat.copy(this.modelQuaternion);
    } else {
      // 1) 위치 이동 (손이 움직인 만큼 오브젝트 이동)
      this._deltaPos.copy(this._currCtrlPos).sub(this.grabStartControllerPos);
      this.modelPosition.copy(this.grabStartModelPos).add(this._deltaPos);

      // 2) 회전: 월드 원점이 아닌 오브젝트 자체의 중심을 기준으로 회전 (deltaQuat = Q_curr * Q_start^-1)
      this._invStartQuat.copy(this.grabStartControllerQuat).invert();
      this._deltaQuat.multiplyQuaternions(this._currCtrlQuat, this._invStartQuat);
      this.modelQuaternion.multiplyQuaternions(this._deltaQuat, this.grabStartModelQuat);

      this.applyTransform();
    }
  }

  /**
   * 양손 줌인/줌아웃: 두 손 사이의 거리를 늘리거나 좁혀서 모델을 오브젝트 중심으로 확대/축소
   */
  handleTwoHandZoom(leftController, rightController) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);

    const currentDistance = this._leftPos.distanceTo(this._rightPos);
    const currentAngle = Math.atan2(this._rightPos.x - this._leftPos.x, this._rightPos.z - this._leftPos.z);

    if (!this.isTwoHandGrabbing) {
      this.isTwoHandGrabbing = true;
      this.initialHandsDistance = currentDistance;
      this.initialModelScale = this.modelScale;
      this.initialHandsAngle = currentAngle;
      this.initialHandsModelQuat.copy(this.modelQuaternion);
    } else {
      // 거리 비율로 오브젝트 스케일 조절 (오브젝트 로컬 중심 줌인/줌아웃)
      if (this.initialHandsDistance > 0.05) {
        const ratio = currentDistance / this.initialHandsDistance;
        this.modelScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * ratio));
      }

      // 두 손을 잇는 축의 수평 회전량 반영
      const deltaAngle = currentAngle - this.initialHandsAngle;
      const rotY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaAngle);
      this.modelQuaternion.multiplyQuaternions(rotY, this.initialHandsModelQuat);

      this.applyTransform();
    }
  }
}
