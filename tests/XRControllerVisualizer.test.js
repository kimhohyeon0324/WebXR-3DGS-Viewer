import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { XRControllerVisualizer } from '../src/core/xr/XRControllerVisualizer.js';

function createControllerWithLaser(handedness = 'right') {
  const ctrl = new THREE.Object3D();
  ctrl.userData = { handedness };

  const laserMat = new THREE.MeshBasicMaterial({
    color: XRControllerVisualizer.COLORS.DEFAULT,
    transparent: true,
    opacity: XRControllerVisualizer.OPACITY.DEFAULT
  });
  const laserMesh = new THREE.Mesh(new THREE.BufferGeometry(), laserMat);
  laserMesh.name = 'laserGuide';
  ctrl.add(laserMesh);

  return ctrl;
}

describe('XRControllerVisualizer - WebXR 컨트롤러 레이저 가이드 및 시각 어포던스 단위 테스트', () => {
  let visualizer;
  let leftCtrl;
  let rightCtrl;

  beforeEach(() => {
    visualizer = new XRControllerVisualizer();
    leftCtrl = createControllerWithLaser('left');
    rightCtrl = createControllerWithLaser('right');
  });

  describe('1. 레이저 스타일 수동 갱신 (setLaserStyle)', () => {
    it('laserGuide 메쉬의 색상과 투명도가 올바르게 변경되어야 한다', () => {
      visualizer.setLaserStyle(rightCtrl, 0xff0000, 0.9);
      const laser = rightCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(0xff0000);
      expect(laser.material.opacity).toBeCloseTo(0.9);
    });

    it('laserGuide 메쉬가 없는 컨트롤러는 에러 없이 무시되어야 한다', () => {
      const bareCtrl = new THREE.Object3D();
      expect(() => visualizer.setLaserStyle(bareCtrl, 0xff0000, 0.5)).not.toThrow();
    });
  });

  describe('2. 인터랙션 상태별 레이저 색상 전이 (update)', () => {
    const emptyTransforms = {
      isLeftRotating: false,
      isRightRotating: false,
      isPanActive: false,
      isTwoHandGrabbing: false
    };

    it('대기 상태(조작/호버 없음)일 때 기본 시안 컬러 및 0.35 투명도가 유지되어야 한다', () => {
      const inputState = { leftTrigger: false, rightTrigger: false, leftGrip: false, rightGrip: false };
      visualizer.update([rightCtrl], inputState, emptyTransforms, null, null);

      const laser = rightCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.DEFAULT);
      expect(laser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.DEFAULT);
    });

    it('왼손 트리거 누름 시 Pitch 틸트(오렌지/앰버) 색상으로 변경되어야 한다', () => {
      const inputState = { leftTrigger: true, rightTrigger: false, leftGrip: false, rightGrip: false };
      visualizer.update([leftCtrl], inputState, emptyTransforms, null, null);

      const laser = leftCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.PITCH);
      expect(laser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.ACTIVE);
    });

    it('오른손 트리거 누름 시 Yaw 자전(보라색) 색상으로 변경되어야 한다', () => {
      const inputState = { leftTrigger: false, rightTrigger: true, leftGrip: false, rightGrip: false };
      visualizer.update([rightCtrl], inputState, emptyTransforms, null, null);

      const laser = rightCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.YAW);
      expect(laser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.ACTIVE);
    });

    it('그립 누름 시 Pan 위치 이동(에메랄드 그린) 색상으로 변경되어야 한다', () => {
      const inputState = { leftTrigger: false, rightTrigger: false, leftGrip: false, rightGrip: true };
      visualizer.update([rightCtrl], inputState, emptyTransforms, null, null);

      const laser = rightCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.PAN);
      expect(laser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.ACTIVE);
    });
  });

  describe('3. POI 핀 호버 감지 및 햅틱 연동', () => {
    it('POI 핀 호버 진입 시 골드 색상으로 변경되고 햅틱이 1회 발송되어야 한다', () => {
      const inputState = { leftTrigger: false, rightTrigger: false, leftGrip: false, rightGrip: false };
      const emptyTransforms = { isLeftRotating: false, isRightRotating: false, isPanActive: false, isTwoHandGrabbing: false };

      const mockPin = { userData: { id: 'poi_1' } };
      const mockPOIManager = {
        checkRayHover: vi.fn().mockReturnValue(mockPin)
      };
      const mockInputReader = {
        triggerHaptic: vi.fn()
      };

      // 첫 번째 호버 틱
      visualizer.update([rightCtrl], inputState, emptyTransforms, mockPOIManager, mockInputReader);

      const laser = rightCtrl.getObjectByName('laserGuide');
      expect(laser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.HOVER);
      expect(laser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.HOVER);
      expect(mockInputReader.triggerHaptic).toHaveBeenCalledWith(rightCtrl, 0.25, 12);

      // 두 번째 호버 틱(동일 핀 유지): 햅틱이 중복 발생하지 않아야 함
      mockInputReader.triggerHaptic.mockClear();
      visualizer.update([rightCtrl], inputState, emptyTransforms, mockPOIManager, mockInputReader);
      expect(mockInputReader.triggerHaptic).not.toHaveBeenCalled();
    });
  });

  describe('4. 리셋(reset)', () => {
    it('reset 호출 시 모든 컨트롤러 레이저가 기본 상태로 복구되어야 한다', () => {
      visualizer.setLaserStyle(rightCtrl, 0xff0000, 1.0);
      visualizer.setLaserStyle(leftCtrl, 0x00ff00, 1.0);

      visualizer.reset([rightCtrl, leftCtrl]);

      const rightLaser = rightCtrl.getObjectByName('laserGuide');
      const leftLaser = leftCtrl.getObjectByName('laserGuide');

      expect(rightLaser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.DEFAULT);
      expect(rightLaser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.DEFAULT);
      expect(leftLaser.material.color.getHex()).toBe(XRControllerVisualizer.COLORS.DEFAULT);
      expect(leftLaser.material.opacity).toBeCloseTo(XRControllerVisualizer.OPACITY.DEFAULT);
    });
  });
});
