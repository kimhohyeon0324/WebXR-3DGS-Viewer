import * as THREE from 'three';

/**
 * WebXR 6DoF 인스펙터(Inspector) 인터랙션 관리자
 * - 오른손 그립(Grab Orbit & Pan): 3DGS 모델을 손으로 잡고 이동 및 손목 각도로 회전
 * - 양손 그립(Pinch Scale & Rotate): 스마트폰 핀치줌처럼 양손을 벌려 확대/축소 및 양손 축 회전
 * - 45도 스냅 회전 (오른손 썸스틱 좌/우): 모델을 45도씩 깔끔하게 정렬 회전
 * - 원터치 정면 시점 복귀 (오른손 트리거 클릭 또는 A 버튼): 현재 HMD 시선 정면 눈높이 1.2m 위치로 모델 복귀 및 리셋
 * - 3D POI 핀 레이저 피킹 (오른손 트리거로 핀 조준 클릭)
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

    // 조작 스케일 제한
    this.minScale = 0.2;
    this.maxScale = 5.0;

    // 스냅 턴 파라미터
    this.snapAngle = THREE.MathUtils.degToRad(45);
    this.snapCooldown = 0.35; // 초 단위 쿨다운
    this.lastSnapTime = 0;
    this.deadzone = 0.5;

    // 한 손 잡기 (One-Hand Grab) 상태
    this.isOneHandGrabbing = false;
    this.grabStartControllerPos = new THREE.Vector3();
    this.grabStartModelPos = new THREE.Vector3();
    this.grabStartControllerYaw = 0;
    this.grabStartModelRotY = 0;

    // 양손 잡기 (Two-Hand Pinch) 상태
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsAngle = 0;
    this.initialHandsRotY = 0;

    // 임시 연산용 벡터 (가비지 컬렉션 방지)
    this._leftPos = new THREE.Vector3();
    this._rightPos = new THREE.Vector3();
    this._deltaPos = new THREE.Vector3();
    this._tempCamPos = new THREE.Vector3();
    this._tempCamDir = new THREE.Vector3();
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();
    this._controllerEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    // 이벤트 바인딩
    this.bindControllerEvents();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
  }

  setSplatManager(splatManager) {
    this.splatManager = splatManager;
  }

  /**
   * 컨트롤러 이벤트 바인딩 (트리거 클릭 시 POI 피킹 또는 시점 리셋)
   */
  bindControllerEvents() {
    const rightController = this.controllers[0];
    if (rightController) {
      rightController.addEventListener('selectstart', () => {
        if (!this.active) return;

        // 1) POI 핀 피킹 검사
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

        // 2) POI 핀을 조준하지 않고 허공 클릭 시: 정면 눈높이로 시점 복귀 (Recenter)
        this.recenterToEyeLevel();
      });
    }
  }

  /**
   * 현재 HMD 시선 정면 눈높이 1.2m 위치로 모델 복귀 및 리셋
   */
  recenterToEyeLevel() {
    if (!this.camera) return;

    this.camera.getWorldPosition(this._tempCamPos);
    this.camera.getWorldDirection(this._tempCamDir);

    // 수평 시선 방향만 추출 (고개 숙임/들림에 영향 받지 않도록 Y축 제거)
    this._tempCamDir.y = 0;
    if (this._tempCamDir.lengthSq() < 0.001) {
      this._tempCamDir.set(0, 0, -1);
    } else {
      this._tempCamDir.normalize();
    }

    // 시선 정면 1.2m, 눈높이 살짝 아래(-0.2m)로 타깃 설정 (가장 편안한 뷰어 관찰 각도)
    this.modelPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, 1.2);
    this.modelPosition.y = Math.max(0.4, this._tempCamPos.y - 0.2);

    // 모델이 사용자를 똑바로 바라보도록 Y축 회전 정렬
    this.modelRotationY = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.modelScale = 1.0;

    this.applyTransform();
    console.log('XRInteraction: 모델을 시선 정면 눈높이로 재정렬(Recenter) 완료');
  }

  /**
   * 모델 트랜스폼을 splatMesh 및 poiGroup에 일괄 적용
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
    this.isOneHandGrabbing = false;
    this.isTwoHandGrabbing = false;

    // VR 진입 시 편안한 정면 위치로 자동 정렬
    setTimeout(() => {
      this.recenterToEyeLevel();
    }, 150);
  }

  deactivate() {
    this.active = false;
    this.isOneHandGrabbing = false;
    this.isTwoHandGrabbing = false;
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

    const leftGrip = !!(leftGamepad?.buttons[1]?.pressed);
    const rightGrip = !!(rightGamepad?.buttons[1]?.pressed);

    const leftController = this.controllers[1];
    const rightController = this.controllers[0];

    // 1) 양손 그립: 핀치 스케일 & 회전
    if (leftGrip && rightGrip && leftController && rightController) {
      this.handleTwoHandedManipulation(leftController, rightController);
    }
    // 2) 오른손 단독 그립: 오브젝트 잡고 이동 및 손목 회전
    else if (rightGrip && rightController) {
      this.isTwoHandGrabbing = false;
      this.handleOneHandGrab(rightController);
    }
    // 3) 그립을 모두 놓았을 때: 잡기 상태 해제
    else {
      this.isOneHandGrabbing = false;
      this.isTwoHandGrabbing = false;
    }

    // 4) 오른손 썸스틱 45도 스냅 회전
    if (rightGamepad && !this.isOneHandGrabbing && !this.isTwoHandGrabbing) {
      this.handleSnapTurn(rightGamepad);
    }

    // 5) A 버튼 (Primary Button, index 4): 즉시 시점 리셋
    if (rightGamepad?.buttons[4]?.pressed) {
      const now = performance.now() / 1000;
      if (now - this.lastSnapTime > 0.5) {
        this.recenterToEyeLevel();
        this.lastSnapTime = now;
      }
    }
  }

  /**
   * 오른손 단독 그립: 공중에 뜬 모델을 손으로 잡고 위치 이동 및 손목 회전
   */
  handleOneHandGrab(controller) {
    controller.getWorldPosition(this._rightPos);
    this._controllerEuler.setFromQuaternion(controller.quaternion, 'YXZ');
    const currentYaw = this._controllerEuler.y;

    if (!this.isOneHandGrabbing) {
      this.isOneHandGrabbing = true;
      this.grabStartControllerPos.copy(this._rightPos);
      this.grabStartModelPos.copy(this.modelPosition);
      this.grabStartControllerYaw = currentYaw;
      this.grabStartModelRotY = this.modelRotationY;
    } else {
      // 1) 위치 이동 (손이 움직인 델타 벡터만큼 모델 이동)
      this._deltaPos.copy(this._rightPos).sub(this.grabStartControllerPos);
      this.modelPosition.copy(this.grabStartModelPos).add(this._deltaPos);

      // 2) 손목 회전 (컨트롤러 Y축 각도 변화만큼 모델 회전)
      const deltaYaw = currentYaw - this.grabStartControllerYaw;
      this.modelRotationY = this.grabStartModelRotY + deltaYaw;

      this.applyTransform();
    }
  }

  /**
   * 양손 그립: 두 손의 거리 비율로 확대/축소 및 두 손 축 각도로 회전
   */
  handleTwoHandedManipulation(leftController, rightController) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);

    const currentDistance = this._leftPos.distanceTo(this._rightPos);
    const currentAngle = Math.atan2(this._rightPos.x - this._leftPos.x, this._rightPos.z - this._leftPos.z);

    if (!this.isTwoHandGrabbing) {
      this.isTwoHandGrabbing = true;
      this.isOneHandGrabbing = false;
      this.initialHandsDistance = currentDistance;
      this.initialModelScale = this.modelScale;
      this.initialHandsAngle = currentAngle;
      this.initialHandsRotY = this.modelRotationY;
    } else {
      // 1) 스케일 확대/축소 (0.2 ~ 5.0배 클램핑)
      if (this.initialHandsDistance > 0.05) {
        const ratio = currentDistance / this.initialHandsDistance;
        this.modelScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * ratio));
      }

      // 2) 회전
      const deltaAngle = currentAngle - this.initialHandsAngle;
      this.modelRotationY = this.initialHandsRotY + deltaAngle;

      this.applyTransform();
    }
  }

  /**
   * 오른손 썸스틱 45도 스냅 회전
   */
  handleSnapTurn(gamepad) {
    const axes = gamepad.axes;
    if (!axes || axes.length < 4) return;

    const stickX = axes[2];
    const now = performance.now() / 1000;

    if (now - this.lastSnapTime < this.snapCooldown) {
      return;
    }

    if (stickX > this.deadzone) {
      this.modelRotationY -= this.snapAngle;
      this.applyTransform();
      this.lastSnapTime = now;
    } else if (stickX < -this.deadzone) {
      this.modelRotationY += this.snapAngle;
      this.applyTransform();
      this.lastSnapTime = now;
    }
  }
}
