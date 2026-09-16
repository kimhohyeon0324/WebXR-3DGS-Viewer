import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

let lastViewerOptions = null;
let mockViewerInstance = null;

vi.mock('@mkkellogg/gaussian-splats-3d', () => {
  return {
    SceneRevealMode: { Instant: 'Instant', Default: 'Default' },
    LogLevel: { None: 0 },
    WebXRMode: { None: 'None', VR: 'VR' },
    RenderMode: { Always: 'Always' },
    SceneFormat: { Ply: 'Ply', Splat: 'Splat', KSplat: 'KSplat' },
    Viewer: vi.fn().mockImplementation((options) => {
      lastViewerOptions = options;
      mockViewerInstance = {
        options,
        renderer: {
          domElement: { parentNode: { removeChild: vi.fn() } },
          dispose: vi.fn(),
          setAnimationLoop: vi.fn()
        },
        camera: {
          position: new THREE.Vector3(0, 1.5, 3.5),
          quaternion: new THREE.Quaternion(),
          up: new THREE.Vector3(0, 1, 0)
        },
        splatMesh: {
          dispose: vi.fn(),
          setSplatScale: vi.fn(),
          setPointCloudModeEnabled: vi.fn()
        },
        stop: vi.fn(),
        removeEventHandlers: vi.fn(),
        dispose: vi.fn(),
        addSplatScene: vi.fn().mockResolvedValue(true)
      };
      return mockViewerInstance;
    })
  };
});

import { SplatManager } from '../src/core/SplatManager.js';
import { GPU_MEMORY_PROFILES } from '../src/data/gpuTuningProfiles.js';

describe('SplatManager GPU Memory Tuning Integration', () => {
  let mockContainer;
  let mockScene;

  beforeEach(() => {
    lastViewerOptions = null;
    mockViewerInstance = null;
    mockContainer = { appendChild: vi.fn() };
    mockScene = new THREE.Scene();
  });

  it('기본 생성 시 BALANCED 프로필이 적용되어야 한다', () => {
    const manager = new SplatManager({
      container: mockContainer,
      threeScene: mockScene
    });

    expect(manager.getCurrentGpuProfileKey()).toBe('BALANCED');
    expect(manager.getCurrentGpuProfile()).toBe(GPU_MEMORY_PROFILES.BALANCED);

    // Viewer 생성자 옵션 검증
    expect(lastViewerOptions.halfPrecisionCovariancesOnGPU).toBe(true);
    expect(lastViewerOptions.inMemoryCompressionLevel).toBe(1);
    expect(lastViewerOptions.freeIntermediateSplatData).toBe(true);
    expect(lastViewerOptions.integerBasedSort).toBe(true);

    // Scene 알파 임계값 검증
    expect(manager.renderSettings.alphaThreshold).toBe(5);
  });

  it('MEMORY_SAVER 프로필로 초기화 시 16-bit 반정밀도 및 8-bit/16-bit 최대 압축이 적용되어야 한다', () => {
    const manager = new SplatManager({
      container: mockContainer,
      threeScene: mockScene,
      gpuProfileKey: 'MEMORY_SAVER'
    });

    expect(manager.getCurrentGpuProfileKey()).toBe('MEMORY_SAVER');
    expect(lastViewerOptions.halfPrecisionCovariancesOnGPU).toBe(true);
    expect(lastViewerOptions.inMemoryCompressionLevel).toBe(2);
    expect(lastViewerOptions.freeIntermediateSplatData).toBe(true);
    expect(lastViewerOptions.integerBasedSort).toBe(false);
    expect(manager.renderSettings.alphaThreshold).toBe(12);
  });

  it('HIGH_QUALITY 프로필로 초기화 시 FP32 원본 정밀도 및 무압축이 적용되어야 한다', () => {
    const manager = new SplatManager({
      container: mockContainer,
      threeScene: mockScene,
      gpuProfileKey: 'HIGH_QUALITY'
    });

    expect(manager.getCurrentGpuProfileKey()).toBe('HIGH_QUALITY');
    expect(lastViewerOptions.halfPrecisionCovariancesOnGPU).toBe(false);
    expect(lastViewerOptions.inMemoryCompressionLevel).toBe(0);
    expect(lastViewerOptions.freeIntermediateSplatData).toBe(false);
    expect(manager.renderSettings.alphaThreshold).toBe(1);
  });

  it('applyGpuProfile() 호출 시 기존 뷰어를 정리하고 새 프로필로 뷰어를 안전하게 재구축해야 한다', async () => {
    const manager = new SplatManager({
      container: mockContainer,
      threeScene: mockScene,
      gpuProfileKey: 'HIGH_QUALITY'
    });

    const firstViewer = mockViewerInstance;
    expect(manager.getCurrentGpuProfileKey()).toBe('HIGH_QUALITY');

    // 프로필을 MEMORY_SAVER로 동적 전환
    await manager.applyGpuProfile('MEMORY_SAVER');

    expect(firstViewer.stop).toHaveBeenCalled();
    expect(firstViewer.removeEventHandlers).toHaveBeenCalled();
    expect(manager.getCurrentGpuProfileKey()).toBe('MEMORY_SAVER');
    expect(lastViewerOptions.inMemoryCompressionLevel).toBe(2);
    expect(lastViewerOptions.halfPrecisionCovariancesOnGPU).toBe(true);
    expect(manager.renderSettings.alphaThreshold).toBe(12);
  });

  it('dispose() 호출 시 destroyViewer()가 실행되어 WebGL 리소스가 정리되어야 한다', async () => {
    const manager = new SplatManager({
      container: mockContainer,
      threeScene: mockScene
    });

    const viewer = mockViewerInstance;
    await manager.dispose();

    expect(viewer.stop).toHaveBeenCalled();
    expect(viewer.renderer.dispose).toHaveBeenCalled();
    expect(manager.viewer).toBeNull();
  });
});
