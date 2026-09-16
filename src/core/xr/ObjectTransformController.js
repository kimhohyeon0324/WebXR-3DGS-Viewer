import * as THREE from 'three';

/**
 * 3D 변환 및 물리 조작 기본 설정 상수
 */
export const DEFAULT_TRANSFORM_CONFIG = {
  DEFAULT_PIVOT: [0, 1.15, 0], // Bonsai 물체 정렬 기준 시각적 피벗 좌표 유지
  MIN_SCALE: 0.1,
  MAX_SCALE: 6.0,
  ROTATION_POS_SENSITIVITY: 4.0,
  ROTATION_WRIST_SENSITIVITY: 1.8,
  PAN_SENSITIVITY: 3.5,
  TWO_HAND_MOVE_MULTIPLIER: 2.5,
  TWO_HAND_MIN_INITIAL_DIST: 0.05,
  TWO_HAND_MIN_CURRENT_DIST: 0.02,
  THUMBSTICK_ZOOM_RATE: 1.2,
  THUMBSTICK_DEADZONE: 0.12,
  EMA_DAMPING_RATE: 22,
  MAX_DELTA_TIME: 0.05,
  DEFAULT_VIEW_DISTANCE: 1.3,
  DEFAULT_VIEW_HEIGHT_OFFSET: -0.10,
  MIN_VIEW_HEIGHT: 0.6
};

/**
 * 3D Spatial Transform & Mathematical Physics Engine
 * 
 * 피벗 역보정(Pivot Offset Compensation), 단일 축 분리 쿼터니언 회전(Single-Axis Pitch/Yaw),
 * 지수 감쇠 물리 스무딩(EMA Damping), 스케일 클램핑 및 NaN/무한대 수치 가드를 전담하는 순수 3D 수학 엔진입니다.
 */
export class ObjectTransformController {
  /**
   * @param {Object} [options]
   * @param {Object} [options.config] - 사용자 커스텀 변환/물리 설정 오버라이드
   * @param {THREE.Vector3} [options.pivotOffset] - 오브젝트 중심 피벗 오프셋
   * @param {number} [options.minScale=0.1]
   * @param {number} [options.maxScale=6.0]
   */
  constructor(options = {}) {
    this.config = {
      ...DEFAULT_TRANSFORM_CONFIG,
      ...(options.config || {})
    };

    // 렌더링에 실시간 적용되는 현재 트랜스폼
    this.modelPosition = new THREE.Vector3(0, 0, 0);
    this.modelQuaternion = new THREE.Quaternion();
    this.modelScale = 1.0;

    // 지수 감쇠 스무딩(EMA)의 목표 트랜스폼
    this.targetPosition = new THREE.Vector3(0, 0, 0);
    this.targetQuaternion = new THREE.Quaternion();
    this.targetScale = 1.0;

    // 조작 제약 조건
    this.minScale = options.minScale ?? this.config.MIN_SCALE;
    this.maxScale = options.maxScale ?? this.config.MAX_SCALE;

    // 오브젝트 중심 피벗 오프셋
    this.pivotOffset = options.pivotOffset
      ? new THREE.Vector3().copy(options.pivotOffset)
      : new THREE.Vector3(...this.config.DEFAULT_PIVOT);

    // 1. 단일 축 분리 회전 (Trigger Drag)
    // Left Trigger: X축 회전 (Pitch / 상하 수직 틸트)
    this.isLeftRotating = false;
    this.leftPrevCtrlPos = new THREE.Vector3();
    this.leftPrevCtrlQuat = new THREE.Quaternion();

    // Right Trigger: Y축 회전 (Yaw / 좌우 수평 자전)
    this.isRightRotating = false;
    this.rightPrevCtrlPos = new THREE.Vector3();
    this.rightPrevCtrlQuat = new THREE.Quaternion();

    // 2. 위치 이동 (Grip Drag)
    this.activePanController = null;
    this.panStartCtrlPos = new THREE.Vector3();
    this.panStartModelPos = new THREE.Vector3();

    // 3. 양손 줌/회전/이동 상태
    this.isTwoHandGrabbing = false;
    this.initialHandsDistance = 0;
    this.initialModelScale = 1.0;
    this.initialHandsVec = new THREE.Vector3();
    this.initialMidpoint = new THREE.Vector3();
    this.initialModelPos = new THREE.Vector3();
    this.initialModelQuat = new THREE.Quaternion();

    // 임시 연산용 객체 (Zero GC 보장)
    this._xAxis = new THREE.Vector3(1, 0, 0);
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._camRightAxis = new THREE.Vector3();
    this._quatX = new THREE.Quaternion();
    this._quatY = new THREE.Quaternion();
    this._ctrlFwd = new THREE.Vector3();
    this._prevCtrlFwd = new THREE.Vector3();
    this._crossFwd = new THREE.Vector3();
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
    this._tempPivotScaled = new THREE.Vector3();
    this._tempPivotRotated = new THREE.Vector3();
    this._meshWorldPos = new THREE.Vector3();
  }

  /**
   * 3D 벡터 수치 무결성 검증 (NaN / Infinity 오염 차단 가드)
   */
  _isValidVector(v) {
    return v !== null && v !== undefined && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }

  /**
   * 쿼터니언 수치 무결성 검증 (NaN / Infinity 오염 차단 가드)
   */
  _isValidQuaternion(q) {
    return q !== null && q !== undefined && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
  }

  setPivotOffset(offset) {
    if (offset) {
      this.pivotOffset.copy(offset);
    }
  }

  /**
   * 활성 컨트롤러 조작 상태 초기화 (세션 진입/퇴장/리센터 시)
   */
  resetTransformState() {
    this.isLeftRotating = false;
    this.isRightRotating = false;
    this.activePanController = null;
    this.isTwoHandGrabbing = false;
  }

  /**
   * VR 진입 시 사용자의 정면 눈높이 위치로 모델 초기 배치
   * @param {THREE.Camera} camera
   */
  initViewPosition(camera) {
    if (!camera) return;

    camera.getWorldPosition(this._tempCamPos);
    camera.getWorldDirection(this._tempCamDir);

    this._tempCamDir.y = 0;
    if (this._tempCamDir.lengthSq() < 0.001) {
      this._tempCamDir.set(0, 0, -1);
    } else {
      this._tempCamDir.normalize();
    }

    // 시선 정면 배치 (상수 기반)
    this.targetPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, this.config.DEFAULT_VIEW_DISTANCE);
    this.targetPosition.y = Math.max(this.config.MIN_VIEW_HEIGHT, this._tempCamPos.y + this.config.DEFAULT_VIEW_HEIGHT_OFFSET);

    const yaw = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.targetQuaternion.setFromAxisAngle(this._yAxis, yaw);
    this.targetScale = 1.0;

    // 즉시 동기화
    this.modelPosition.copy(this.targetPosition);
    this.modelQuaternion.copy(this.targetQuaternion);
    this.modelScale = this.targetScale;

    this.resetTransformState();
  }

  /**
   * 시선 정면으로 모델 즉시/부드럽게 복귀 (Recenter)
   * @param {THREE.Camera} camera
   */
  recenterView(camera) {
    if (!camera) return;

    camera.getWorldPosition(this._tempCamPos);
    camera.getWorldDirection(this._tempCamDir);

    this._tempCamDir.y = 0;
    if (this._tempCamDir.lengthSq() < 0.001) {
      this._tempCamDir.set(0, 0, -1);
    } else {
      this._tempCamDir.normalize();
    }

    this.targetPosition.copy(this._tempCamPos).addScaledVector(this._tempCamDir, this.config.DEFAULT_VIEW_DISTANCE);
    this.targetPosition.y = Math.max(this.config.MIN_VIEW_HEIGHT, this._tempCamPos.y + this.config.DEFAULT_VIEW_HEIGHT_OFFSET);

    const yaw = Math.atan2(this._tempCamDir.x, this._tempCamDir.z) + Math.PI;
    this.targetQuaternion.setFromAxisAngle(this._yAxis, yaw);
    this.targetScale = 1.0;

    this.resetTransformState();
  }

  /**
   * 왼쪽 트리거: X축에 대한 순수 회전 (Pitch / 상하 수직 틸트)
   * @param {THREE.XRTargetRaySpace} controller
   * @param {THREE.Camera} camera
   * @param {Function} [onHaptic]
   */
  handleLeftTriggerRotate(controller, camera, onHaptic) {
    controller.getWorldPosition(this._currCtrlPos);
    const currQuat = controller.quaternion;

    // NaN 방어 가드
    if (!this._isValidVector(this._currCtrlPos) || !this._isValidQuaternion(currQuat)) {
      return;
    }

    if (!this.isLeftRotating) {
      this.isLeftRotating = true;
      this.leftPrevCtrlPos.copy(this._currCtrlPos);
      this.leftPrevCtrlQuat.copy(currQuat);
      if (typeof onHaptic === 'function') onHaptic(controller, 0.4, 20);
      return;
    }

    // 1) 컨트롤러의 수직 이동량 (상하 드래그 -> 피치 회전)
    const dy = this._currCtrlPos.y - this.leftPrevCtrlPos.y;

    // 2) 컨트롤러 손목 피치 변화량 (외적으로 계산하여 짐벌락/각도 도약 차단)
    this._ctrlFwd.set(0, 0, -1).applyQuaternion(currQuat);
    this._prevCtrlFwd.set(0, 0, -1).applyQuaternion(this.leftPrevCtrlQuat);
    this._crossFwd.crossVectors(this._prevCtrlFwd, this._ctrlFwd);

    // 사용자의 시선에 수직인 수평 회전축(Camera-relative Right Axis)
    if (camera) {
      this._camRightAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this._camRightAxis.y = 0;
      if (this._camRightAxis.lengthSq() < 0.0001) {
        this._camRightAxis.set(1, 0, 0);
      } else {
        this._camRightAxis.normalize();
      }
    } else {
      this._camRightAxis.set(1, 0, 0);
    }

    // 손목 피치 변화량을 수평 회전축에 투영
    const wristPitchDelta = this._crossFwd.dot(this._camRightAxis);

    this.leftPrevCtrlPos.copy(this._currCtrlPos);
    this.leftPrevCtrlQuat.copy(currQuat);

    const posSensitivity = this.config.ROTATION_POS_SENSITIVITY;
    const wristSensitivity = this.config.ROTATION_WRIST_SENSITIVITY;
    const deltaPitch = (-dy * posSensitivity) + (-wristPitchDelta * wristSensitivity);

    if (Math.abs(deltaPitch) > 0.0001) {
      this._quatX.setFromAxisAngle(this._camRightAxis, deltaPitch);
      this.targetQuaternion.premultiply(this._quatX);
      this.targetQuaternion.normalize();
    }
  }

  stopLeftTriggerRotate(controller, onHaptic) {
    if (this.isLeftRotating) {
      this.isLeftRotating = false;
      if (controller && typeof onHaptic === 'function') onHaptic(controller, 0.2, 15);
    }
  }

  /**
   * 오른쪽 트리거: Y축에 대한 순수 회전 (Yaw / 좌우 수평 자전)
   * @param {THREE.XRTargetRaySpace} controller
   * @param {THREE.Camera} camera
   * @param {Function} [onHaptic]
   */
  handleRightTriggerRotate(controller, camera, onHaptic) {
    controller.getWorldPosition(this._currCtrlPos);
    const currQuat = controller.quaternion;

    // NaN 방어 가드
    if (!this._isValidVector(this._currCtrlPos) || !this._isValidQuaternion(currQuat)) {
      return;
    }

    if (!this.isRightRotating) {
      this.isRightRotating = true;
      this.rightPrevCtrlPos.copy(this._currCtrlPos);
      this.rightPrevCtrlQuat.copy(currQuat);
      if (typeof onHaptic === 'function') onHaptic(controller, 0.4, 20);
      return;
    }

    // 사용자 시선 기준 수평 Right 벡터
    if (camera) {
      this._camRightAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this._camRightAxis.y = 0;
      if (this._camRightAxis.lengthSq() < 0.0001) {
        this._camRightAxis.set(1, 0, 0);
      } else {
        this._camRightAxis.normalize();
      }
    } else {
      this._camRightAxis.set(1, 0, 0);
    }

    // 1) 컨트롤러의 수평 이동량 (카메라 수평 Right 축에 정사영)
    this._deltaPos.subVectors(this._currCtrlPos, this.rightPrevCtrlPos);
    const dxCam = this._deltaPos.dot(this._camRightAxis);

    // 2) 컨트롤러 손목 요(Yaw) 각도 변화량 (외적의 수직 Y 성분)
    this._ctrlFwd.set(0, 0, -1).applyQuaternion(currQuat);
    this._prevCtrlFwd.set(0, 0, -1).applyQuaternion(this.rightPrevCtrlQuat);
    this._crossFwd.crossVectors(this._prevCtrlFwd, this._ctrlFwd);
    const wristYawDelta = -this._crossFwd.y;

    this.rightPrevCtrlPos.copy(this._currCtrlPos);
    this.rightPrevCtrlQuat.copy(currQuat);

    const posSensitivity = this.config.ROTATION_POS_SENSITIVITY;
    const wristSensitivity = this.config.ROTATION_WRIST_SENSITIVITY;
    const deltaYaw = (dxCam * posSensitivity) + (wristYawDelta * wristSensitivity);

    if (Math.abs(deltaYaw) > 0.0001) {
      this._quatY.setFromAxisAngle(this._yAxis, deltaYaw);
      this.targetQuaternion.premultiply(this._quatY);
      this.targetQuaternion.normalize();
    }
  }

  stopRightTriggerRotate(controller, onHaptic) {
    if (this.isRightRotating) {
      this.isRightRotating = false;
      if (controller && typeof onHaptic === 'function') onHaptic(controller, 0.2, 15);
    }
  }

  /**
   * 그립 드래그: 모델 위치 이동 (Pan)
   * @param {THREE.XRTargetRaySpace} controller
   * @param {Function} [onHaptic]
   */
  handlePanGrab(controller, onHaptic) {
    controller.getWorldPosition(this._currCtrlPos);
    if (!this._isValidVector(this._currCtrlPos)) return;

    if (this.activePanController !== controller) {
      this.activePanController = controller;
      this.panStartCtrlPos.copy(this._currCtrlPos);
      this.panStartModelPos.copy(this.targetPosition);
      if (typeof onHaptic === 'function') onHaptic(controller, 0.4, 20);
    } else {
      const panSensitivity = this.config.PAN_SENSITIVITY;
      this._deltaPos.copy(this._currCtrlPos).sub(this.panStartCtrlPos).multiplyScalar(panSensitivity);
      this.targetPosition.copy(this.panStartModelPos).add(this._deltaPos);
    }
  }

  stopPanGrab(onHaptic) {
    if (this.activePanController) {
      if (typeof onHaptic === 'function') onHaptic(this.activePanController, 0.2, 15);
      this.activePanController = null;
    }
  }

  /**
   * 양손 잡기: 3D 회전 + 줌인/줌아웃 + 중심점 이동
   * @param {THREE.XRTargetRaySpace} leftController
   * @param {THREE.XRTargetRaySpace} rightController
   * @param {Function} [onHaptic]
   */
  handleTwoHandTransform(leftController, rightController, onHaptic) {
    leftController.getWorldPosition(this._leftPos);
    rightController.getWorldPosition(this._rightPos);
    if (!this._isValidVector(this._leftPos) || !this._isValidVector(this._rightPos)) return;

    this._currMidpoint.addVectors(this._leftPos, this._rightPos).multiplyScalar(0.5);
    this._currHandsVec.subVectors(this._rightPos, this._leftPos);
    const currentDistance = this._currHandsVec.length();

    if (!this.isTwoHandGrabbing) {
      this.isTwoHandGrabbing = true;
      this.initialHandsDistance = Math.max(this.config.TWO_HAND_MIN_INITIAL_DIST, currentDistance);
      this.initialModelScale = this.targetScale;
      this.initialHandsVec.copy(this._currHandsVec);
      this.initialMidpoint.copy(this._currMidpoint);
      this.initialModelQuat.copy(this.targetQuaternion);
      this.initialModelPos.copy(this.targetPosition);

      if (typeof onHaptic === 'function') {
        onHaptic(leftController, 0.6, 25);
        onHaptic(rightController, 0.6, 25);
      }
    } else {
      if (this.initialHandsDistance > this.config.TWO_HAND_MIN_INITIAL_DIST && currentDistance > this.config.TWO_HAND_MIN_CURRENT_DIST) {
        // 1. 확대 / 축소 (오브젝트 로컬 중심)
        const scaleRatio = currentDistance / this.initialHandsDistance;
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.initialModelScale * scaleRatio));

        // 한계 도달 시 햅틱 피드백
        if ((newScale === this.minScale || newScale === this.maxScale) && this.targetScale !== newScale) {
          if (typeof onHaptic === 'function') {
            onHaptic(leftController, 0.4, 15);
            onHaptic(rightController, 0.4, 15);
          }
        }
        this.targetScale = newScale;

        // 2. 3D 회전 (오브젝트 로컬 중심)
        this._u0.copy(this.initialHandsVec).normalize();
        this._u1.copy(this._currHandsVec).normalize();
        this._deltaQuat.setFromUnitVectors(this._u0, this._u1);
        this.targetQuaternion.multiplyQuaternions(this._deltaQuat, this.initialModelQuat);
        this.targetQuaternion.normalize();

        // 3. 위치 이동 (두 손의 중심점 추종)
        this._deltaMidpoint.subVectors(this._currMidpoint, this.initialMidpoint).multiplyScalar(this.config.TWO_HAND_MOVE_MULTIPLIER);
        this.targetPosition.addVectors(this.initialModelPos, this._deltaMidpoint);
      }
    }
  }

  stopTwoHandTransform() {
    this.isTwoHandGrabbing = false;
  }

  /**
   * 썸스틱 상/하 입력에 따른 스케일 확대/축소
   * @param {number} stickZoom
   * @param {number} delta
   */
  handleThumbstickZoom(stickZoom, delta = 0.016) {
    if (Math.abs(stickZoom) <= this.config.THUMBSTICK_DEADZONE) return;
    const zoomRate = this.config.THUMBSTICK_ZOOM_RATE;
    const factor = 1.0 - (stickZoom * zoomRate * Math.min(delta, this.config.MAX_DELTA_TIME));
    if (Number.isFinite(factor) && factor > 0) {
      this.targetScale = Math.max(this.minScale, Math.min(this.maxScale, this.targetScale * factor));
    }
  }

  /**
   * 물리적 지수 감쇠 스무딩(EMA Damping)으로 손떨림 흡수
   * @param {number} delta
   */
  updateSmoothing(delta = 0.016) {
    const smoothFactor = 1.0 - Math.exp(-this.config.EMA_DAMPING_RATE * Math.min(delta, this.config.MAX_DELTA_TIME));

    if (this._isValidVector(this.targetPosition)) {
      this.modelPosition.lerp(this.targetPosition, smoothFactor);
    }
    if (this._isValidQuaternion(this.targetQuaternion)) {
      this.modelQuaternion.slerp(this.targetQuaternion, smoothFactor);
      this.modelQuaternion.normalize();
    }
    if (Number.isFinite(this.targetScale) && this.targetScale > 0) {
      this.modelScale += (this.targetScale - this.modelScale) * smoothFactor;
    } else {
      this.targetScale = 1.0;
      this.modelScale = 1.0;
    }
  }

  /**
   * 오브젝트 중심 피벗 역보정 계산 후 스플랫 및 POI에 최종 트랜스폼 적용
   * MeshWorldPos = modelPosition - (modelQuaternion * (pivotOffset * modelScale))
   * @param {THREE.Object3D} [splatMesh]
   * @param {THREE.Object3D} [targetScene]
   * @param {Object} [poiManager]
   */
  applyTransform(splatMesh, targetScene, poiManager) {
    try {
      // NaN 방어 가드: 비정상 수치에 의한 메쉬 증발/소실 차단
      if (!this._isValidVector(this.modelPosition) ||
          !this._isValidQuaternion(this.modelQuaternion) ||
          !Number.isFinite(this.modelScale) ||
          this.modelScale <= 0) {
        return;
      }

      // 오브젝트 중심 피벗 계산
      this._tempPivotScaled.copy(this.pivotOffset).multiplyScalar(this.modelScale);
      this._tempPivotRotated.copy(this._tempPivotScaled).applyQuaternion(this.modelQuaternion);
      this._meshWorldPos.copy(this.modelPosition).sub(this._tempPivotRotated);

      if (splatMesh) {
        splatMesh.position.copy(this._meshWorldPos);
        splatMesh.quaternion.copy(this.modelQuaternion);
        splatMesh.scale.setScalar(this.modelScale);
        const splatMeshAny = /** @type {any} */ (splatMesh);
        if (typeof splatMeshAny.updateTransforms === 'function') {
          splatMeshAny.updateTransforms();
        }
      } else if (targetScene) {
        targetScene.position.copy(this._meshWorldPos);
        targetScene.quaternion.copy(this.modelQuaternion);
        targetScene.scale.setScalar(this.modelScale);
      }

      if (poiManager && typeof poiManager.setTransform === 'function') {
        poiManager.setTransform(this._meshWorldPos, this.modelQuaternion, this.modelScale);
      }
    } catch (e) {
      console.warn('[ObjectTransformController] applyTransform catch:', e);
    }
  }
}
