import * as THREE from 'three';

/**
 * WebXR 6DoF 직관적·물리적 뷰어 인터랙션 관리자 (Ergonomic Hybrid Transform System)
 * 
 * 1. 스마트 하이브리드 잡기 (Smart Hybrid Grab):
 *    - Grip(손잡이) 버튼: 물체를 쥐는 해부학적 동작 -> 100% 모델 잡기 전담.
 *    - Trigger(방아쇠) 버튼: 대상을 가리키고 누르는 동작 -> POI 핀 조준 시 클릭/토글 전담, 빈 공간 조준 시 잡기로 유연 대응.
 * 2. 한 손 잡기 (One-Hand Translation):
 *    - 손의 이동 궤적을 1:1로 추종하는 순수 공간 위치 이동 (손목 회전 왜곡 원천 차단).
 * 3. 양손 잡기 (Two-Hand Transform):
 *    - 두 손으로 잡고 돌리기 -> 오브젝트 로컬 중심 3D 회전.
 *    - 두 손 간격 벌리기/좁히기 -> 오브젝트 로컬 중심 확대/축소 (3D 핀치 줌).
 *    - 두 손 함께 이동하기 -> 두 손의 중심점을 추종하는 공간 이동.
 * 4. 햅틱 & 시각 피드백 (Haptic & Visual Affordance):
 *    - 잡기/놓기, POI 조준(Hover), 클릭, 한계 도달 시 손끝으로 전해지는 정밀 햅틱 펄스.
 *    - 레이저 상태 변화 (대기: 시안, 핀 조준: 골드, 모델 잡기: 에메랄드).
 * 5. 물리 스무딩 (Exponential Damping):
 *    - 60~90Hz 센서 미세 떨림을 흡수하는 지수 감쇠(EMA)로 버터처럼 부드러운 조작감 제공.
 * 6. 원클릭 시선 정면 복귀 (Recenter):
 *    - Meta Quest A/X 버튼 클릭 시 사용자의 현재 시선 정면 1.3m로 부드럽게 모델 복귀.
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

    // 렌더링에 실시간 적용되는 현재 트랜스폼
    this.modelPosition = new THREE.Vector3(0, 0, 0);
    this.modelQuaternion = new THREE.Quaternion();
    this.modelScale = 1.0;

    // 지수 감쇠 스무딩(EMA)의 목표 트랜스폼
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.targetQuaternion = new THREE.Quaternion();
    this.targetScale = 1.0;

    // 조작 제약 조건
    this.minScale = 0.1;
    this.maxScale = 6.0;

    // 한 손 잡기(Grab) 상태
    this.activeGrabController = null;
    this.grabStartControllerPos = new THREE.Vector3();
    this.grabStartModelPos = new THREE.Vector3();

    // 양손 줌/회전/이동 상태 추적
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsVec = new THREE.Vector3();
    this.initialMidpoint = new THREE.Vector3();
    this.initialModelPos = new THREE.Vector3();
    this.initialModelQuat = new THREE.Quaternion();

    // 버튼 디바운싱 & 호버 상태
    this._wasRecenterPressed = false;
    this._hoveredPins = new Map();

    // 임시 연산용 객체 (GC 방지)
    this._leftPos = new THREE.Vector3();
    this._rightPos = new THREE.Vector3();
    this._currMidpoint = new THREE.Vector3();
    this._currHandsVec = new THREE.Vector3();
    this._deltaMidpoint = new THREE.Vector3();
    this._u0 = new THREE.Vector3();
    this._u1 = new THREE.Vector3();
    this._currCtrlPos = new THREE.Vector3();
    this._deltaPos = new THREE.Vector3();
    this._deltaQuat = new THREE.Quaternion();
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
   * 컨트롤러 진동(햅틱) 펄스 발생
   */
  triggerHaptic(controller, intensity = 0.5, durationMs = 25) {
    const gamepad = controller?.userData?.inputSource?.gamepad;
    if (gamepad?.hapticActuators && gamepad.hapticActuators[0]) {
      gamepad.hapticActuators[0].pulse(intensity, durationMs).catch(() => {});
    }
  }

  /**
   * 레이저 가이드라인 색상 및 불투명도 조절
   */
  setLaserStyle(controller, hexColor, opacity) {
    const laser = controller?.getObjectByName('laserGuide');
    if (laser && laser.material) {
      laser.material.color.setHex(hexColor);
      laser.material.opacity = opacity;
    }
  }

  /**
   * 컨트롤러 WebXR 이벤트 바인딩
   * - Trigger: POI 핀 피킹 및 빈 공간 잡기
   * - Grip(Squeeze): 100% 모델 잡기 전담 (인체공학적 쥐기)
   */
  bindControllerEvents() {
    this.controllers.forEach((controller) => {
      if (!controller) return;

      // 1. 트리거(Trigger / select) 누름
      controller.addEventListener('selectstart', () => {
        if (!this.active) return;

        // POI 핀 레이저 피킹 우선 확인
        if (this.poiManager) {
          controller.getWorldPosition(this._tempRayOrigin);
          controller.getWorldDirection(this._tempRayDirection);
          this._tempRayDirection.negate();
          const pickedPOI = this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
          if (pickedPOI) {
            controller.userData.isPickingPOI = true;
            this.triggerHaptic(controller, 0.75, 35);
            return;
          }
        }

        // 빈 공간이라면 잡기 의도로 등록
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = true;
      });

      controller.addEventListener('selectend', () => {
        controller.userData.isPickingPOI = false;
        controller.userData.isTriggerHeld = false;
      });

      // 2. 그립(Grip / squeeze) 누름 (물리적 손잡이 쥐기)
      controller.addEventListener('squeezestart', () => {
        if (!this.active) return;
        controller.userData.isGripHeld = true;
      });

      controller.addEventListener('squeezeend', () => {
        controller.userData.isGripHeld = false;
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

    // 시선 정면 1.3m, 눈높이 살짝 아래(-0.15m)에 편안하게 배치
    this.targetPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, 1.3);
    this.targetPosition.y = Math.max(0.4, this._tempCamPos.y - 0.15);

    const yaw = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.targetScale = 1.0;

    // 즉시 동기화
    this.modelPosition.copy(this.targetPosition);
    this.modelQuaternion.copy(this.targetQuaternion);
    this.modelScale = this.targetScale;

    this.applyTransform();
  }

  /**
   * 시선 정면으로 모델 즉시/부드럽게 복귀 (Recenter)
   */
  recenterView(sourceController = null) {
    if (!this.camera) return;

    this.camera.getWorldPosition(this._tempCamPos);
    this.camera.getWorldDirection(this._tempCamDir);

    this._tempCamDir.y = 0;
    if (this._tempCamDir.lengthSq() < 0.001) {
      this._tempCamDir.set(0, 0, -1);
    } else {
      this._tempCamDir.normalize();
    }

    this.targetPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, 1.3);
    this.targetPosition.y = Math.max(0.4, this._tempCamPos.y - 0.15);

    const yaw = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.targetScale = 1.0;

    if (sourceController) {
      this.triggerHaptic(sourceController, 0.6, 25);
      setTimeout(() => this.triggerHaptic(sourceController, 0.7, 30), 100);
    }

    if (this.poiManager) {
      this.poiManager.showDefaultVRCard();
    }

    console.log('[XRInteractionManager] 뷰 복귀(Recenter) 실행');
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
      // VR 세션 진입 시 3D POI 정보 카드를 즉시 표시
      if (this.poiManager) {
        this.poiManager.showDefaultVRCard();
      }
    }, 250);
  }

  deactivate() {
    this.active = false;
    this.activeGrabController = null;
    this.isTwoHandGrabbing = false;
  }

  /**
   * 매 프레임 인터랙션 루프
   */
  update(delta = 0.016) {
    if (!this.active) return;

    const session = this.renderer?.xr?.getSession();

    let leftController = null;
    let rightController = null;
    let leftGrab = false;
    let rightGrab = false;
    let recenterPressed = false;
    let recenterSource = null;

    for (let i = 0; i < this.controllers.length; i++) {
      const ctrl = this.controllers[i];
      const handedness = ctrl.userData?.handedness || (i === 0 ? 'right' : 'left');

      const gamepad = ctrl.userData?.inputSource?.gamepad ||
        (session?.inputSources ? Array.from(session.inputSources).find(s => s?.handedness === handedness)?.gamepad : null);

      // 1) 트리거 감지 (POI 피킹 중이 아닐 때만 잡기 인정)
      const triggerEvent = !!ctrl.userData?.isTriggerHeld;
      const triggerGamepad = !ctrl.userData?.isPickingPOI && (gamepad?.buttons[0]?.pressed || gamepad?.buttons[0]?.value > 0.15);
      const isTrigger = triggerEvent || triggerGamepad;

      // 2) 그립(Squeeze) 감지 (물리적 손잡이 쥐기)
      const gripEvent = !!ctrl.userData?.isGripHeld;
      const gripGamepad = (gamepad?.buttons[1]?.pressed || gamepad?.buttons[1]?.value > 0.15);
      const isGrip = gripEvent || gripGamepad;

      // 잡기 의도: 그립 또는 트리거(빈 공간) 중 하나라도 쥐면 잡기로 판단
      const isGrabActive = isGrip || isTrigger;

      // 3) A / X 버튼 감지 (Recenter) - WebXR 표준 버튼 인덱스 4
      if (gamepad?.buttons[4]?.pressed) {
        recenterPressed = true;
        recenterSource = ctrl;
      }

      if (handedness === 'left') {
        leftController = ctrl;
        leftGrab = isGrabActive;
      } else if (handedness === 'right') {
        rightController = ctrl;
        rightGrab = isGrabActive;
      }

      // 4) 레이저 시각 & 햅틱 피드백 관리
      if (!isGrabActive) {
        // POI 핀 호버 검사
        let hoveredPin = null;
        if (this.poiManager && !this.activeGrabController && !this.isTwoHandGrabbing) {
          ctrl.getWorldPosition(this._tempRayOrigin);
          ctrl.getWorldDirection(this._tempRayDirection);
          this._tempRayDirection.negate();
          hoveredPin = this.poiManager.checkRayHover(this._tempRayOrigin, this._tempRayDirection);
        }

        const prevHovered = this._hoveredPins.get(ctrl);
        if (hoveredPin) {
          // 새로 핀에 조준되었을 때 톡 튀는 햅틱 펄스
          if (!prevHovered) {
            this.triggerHaptic(ctrl, 0.25, 12);
          }
          this.setLaserStyle(ctrl, 0xffaa00, 0.95); // 골드
          this._hoveredPins.set(ctrl, hoveredPin);
        } else {
          this.setLaserStyle(ctrl, 0x00f0ff, 0.35); // 기본 시안
          this._hoveredPins.delete(ctrl);
        }
      } else {
        // 잡고 있을 때는 에메랄드 그린
        this.setLaserStyle(ctrl, 0x10b981, 0.75);
      }
    }

    // ==========================================
    // 0. 리센터(Recenter) 버튼 처리 (A / X 버튼)
    // ==========================================
    if (recenterPressed) {
      if (!this._wasRecenterPressed) {
        this._wasRecenterPressed = true;
        this.recenterView(recenterSource);
      }
    } else {
      this._wasRecenterPressed = false;
    }

    // ==========================================
    // 1. 양손 잡기: 3D 회전 + 줌인/줌아웃 + 이동
    // ==========================================
    if (leftGrab && rightGrab && leftController && rightController) {
      this.activeGrabController = null;
      this.handleTwoHandTransform(leftController, rightController);
    }
    // ==========================================
    // 2. 한 손 잡기: 1:1 자유 위치 이동
    // ==========================================
    else if (rightGrab && rightController) {
      if (this.isTwoHandGrabbing) {
        this.isTwoHandGrabbing = false;
        this.triggerHaptic(rightController, 0.3, 15);
      }
      this.handleOneHandGrab(rightController);
    } else if (leftGrab && leftController) {
      if (this.isTwoHandGrabbing) {
        this.isTwoHandGrabbing = false;
        this.triggerHaptic(leftController, 0.3, 15);
      }
      this.handleOneHandGrab(leftController);
    }
    // ==========================================
    // 3. 놓았을 때
    // ==========================================
    else {
      if (this.isTwoHandGrabbing || this.activeGrabController) {
        if (this.activeGrabController) {
          this.triggerHaptic(this.activeGrabController, 0.2, 15);
        }
      }
      this.activeGrabController = null;
      this.isTwoHandGrabbing = false;
    }

    // ==========================================
    // 4. 물리적 지수 감쇠 스무딩 (손떨림 흡수)
    // ==========================================
    const smoothFactor = 1.0 - Math.exp(-22 * Math.min(delta, 0.05));
    this.modelPosition.lerp(this.targetPosition, smoothFactor);
    this.modelQuaternion.slerp(this.targetQuaternion, smoothFactor);
    this.modelScale += (this.targetScale - this.modelScale) * smoothFactor;

    this.applyTransform();
  }

  /**
   * 한 손 잡기: 손의 움직임에 따라 모델 위치 이동 (감도 2.4배 증폭으로 빠르고 시원한 공간 이동)
   */
  handleOneHandGrab(controller) {
    controller.getWorldPosition(this._currCtrlPos);

    if (this.activeGrabController !== controller) {
      this.activeGrabController = controller;
      this.grabStartControllerPos.copy(this._currCtrlPos);
      this.grabStartModelPos.copy(this.targetPosition);
      this.triggerHaptic(controller, 0.5, 20);
    } else {
      const oneHandSensitivity = 2.4; // 손의 움직임 변위를 2.4배로 증폭하여 쾌적한 이동 제공
      this._deltaPos.copy(this._currCtrlPos).sub(this.grabStartControllerPos).multiplyScalar(oneHandSensitivity);
      this.targetPosition.copy(this.grabStartModelPos).add(this._deltaPos);
    }
  }

  /**
   * 양손 잡기: 3D 회전 + 줌인/줌아웃 + 이동
   */
  handleTwoHandTransform(leftController, rightController) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);

    this._currMidpoint.addVectors(this._leftPos, this._rightPos).multiplyScalar(0.5);
    this._currHandsVec.subVectors(this._rightPos, this._leftPos);
    const currentDistance = this._currHandsVec.length();

    if (!this.isTwoHandGrabbing) {
      this.isTwoHandGrabbing = true;
      this.initialHandsDistance = Math.max(0.05, currentDistance);
      this.initialModelScale = this.targetScale;
      this.initialHandsVec.copy(this._currHandsVec);
      this.initialMidpoint.copy(this._currMidpoint);
      this.initialModelQuat.copy(this.targetQuaternion);
      this.initialModelPos.copy(this.targetPosition);

      this.triggerHaptic(leftController, 0.6, 25);
      this.triggerHaptic(rightController, 0.6, 25);
    } else {
      if (this.initialHandsDistance > 0.05 && currentDistance > 0.02) {
        // 1. 확대 / 축소 (오브젝트 로컬 중심)
        const scaleRatio = currentDistance / this.initialHandsDistance;
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * scaleRatio));

        // 한계 도달 시 햅틱 피드백
        if ((newScale === this.minScale || newScale === this.maxScale) && this.targetScale !== newScale) {
          this.triggerHaptic(leftController, 0.4, 15);
          this.triggerHaptic(rightController, 0.4, 15);
        }
        this.targetScale = newScale;

        // 2. 3D 회전 (오브젝트 로컬 중심)
        this._u0.copy(this.initialHandsVec).normalize();
        this._u1.copy(this._currHandsVec).normalize();
        this._deltaQuat.setFromUnitVectors(this._u0, this._u1);
        this.targetQuaternion.multiplyQuaternions(this._deltaQuat, this.initialModelQuat);

        // 3. 위치 이동 (두 손의 중심점 추종 - 1.8배 시원한 이동)
        this._deltaMidpoint.subVectors(this._currMidpoint, this.initialMidpoint).multiplyScalar(1.8);
        this.targetPosition.addVectors(this.initialModelPos, this._deltaMidpoint);
      }
    }
  }
}
