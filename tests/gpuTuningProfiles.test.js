import { describe, it, expect } from 'vitest';
import {
  GPU_MEMORY_PROFILES,
  DEFAULT_GPU_PROFILE_KEY,
  getGpuProfile
} from '../src/data/gpuTuningProfiles.js';

describe('GPU Memory Tuning Profiles', () => {
  it('기본 프로필 키가 BALANCED로 지정되어 있어야 한다', () => {
    expect(DEFAULT_GPU_PROFILE_KEY).toBe('BALANCED');
    expect(GPU_MEMORY_PROFILES[DEFAULT_GPU_PROFILE_KEY]).toBeDefined();
  });

  it('필수 프로필 3종(HIGH_QUALITY, BALANCED, MEMORY_SAVER)이 정의되어 있어야 한다', () => {
    const requiredKeys = ['HIGH_QUALITY', 'BALANCED', 'MEMORY_SAVER'];
    for (const key of requiredKeys) {
      expect(GPU_MEMORY_PROFILES[key]).toBeDefined();
      expect(GPU_MEMORY_PROFILES[key].key).toBe(key);
      expect(typeof GPU_MEMORY_PROFILES[key].name).toBe('string');
      expect(typeof GPU_MEMORY_PROFILES[key].badgeText).toBe('string');
      expect(typeof GPU_MEMORY_PROFILES[key].description).toBe('string');
    }
  });

  it('모든 프로필은 필수 viewerOptions 및 sceneOptions 필드를 완비해야 한다', () => {
    for (const [_key, profile] of Object.entries(GPU_MEMORY_PROFILES)) {
      expect(profile.viewerOptions).toBeDefined();
      expect(typeof profile.viewerOptions.halfPrecisionCovariancesOnGPU).toBe('boolean');
      expect([0, 1, 2]).toContain(profile.viewerOptions.inMemoryCompressionLevel);
      expect(typeof profile.viewerOptions.freeIntermediateSplatData).toBe('boolean');
      expect(typeof profile.viewerOptions.integerBasedSort).toBe('boolean');

      expect(profile.sceneOptions).toBeDefined();
      expect(typeof profile.sceneOptions.splatAlphaRemovalThreshold).toBe('number');
      expect(profile.sceneOptions.splatAlphaRemovalThreshold).toBeGreaterThanOrEqual(0);
      expect(profile.sceneOptions.splatAlphaRemovalThreshold).toBeLessThanOrEqual(255);
    }
  });

  it('BALANCED 프로필은 FP16 반정밀도, 16비트 압축, 중간 버퍼 해제를 활성화해야 한다', () => {
    const balanced = GPU_MEMORY_PROFILES.BALANCED;
    expect(balanced.viewerOptions.halfPrecisionCovariancesOnGPU).toBe(true);
    expect(balanced.viewerOptions.inMemoryCompressionLevel).toBe(1);
    expect(balanced.viewerOptions.freeIntermediateSplatData).toBe(true);
    expect(balanced.sceneOptions.splatAlphaRemovalThreshold).toBe(5);
  });

  it('MEMORY_SAVER 프로필은 Quest 및 대용량 씬을 위해 최대 압축 및 정수 오버플로우 방지를 설정해야 한다', () => {
    const saver = GPU_MEMORY_PROFILES.MEMORY_SAVER;
    expect(saver.viewerOptions.halfPrecisionCovariancesOnGPU).toBe(true);
    expect(saver.viewerOptions.inMemoryCompressionLevel).toBe(2);
    expect(saver.viewerOptions.freeIntermediateSplatData).toBe(true);
    expect(saver.viewerOptions.integerBasedSort).toBe(false);
    expect(saver.sceneOptions.splatAlphaRemovalThreshold).toBe(12);
  });

  it('HIGH_QUALITY 프로필은 원본 부동소수점(FP32) 및 무압축을 유지해야 한다', () => {
    const hq = GPU_MEMORY_PROFILES.HIGH_QUALITY;
    expect(hq.viewerOptions.halfPrecisionCovariancesOnGPU).toBe(false);
    expect(hq.viewerOptions.inMemoryCompressionLevel).toBe(0);
    expect(hq.viewerOptions.freeIntermediateSplatData).toBe(false);
    expect(hq.sceneOptions.splatAlphaRemovalThreshold).toBe(1);
  });

  it('getGpuProfile()은 유효한 키에 대해 해당 프로필을 반환하고 무효한 키에 대해 BALANCED를 fallback 반환해야 한다', () => {
    expect(getGpuProfile('HIGH_QUALITY').key).toBe('HIGH_QUALITY');
    expect(getGpuProfile('MEMORY_SAVER').key).toBe('MEMORY_SAVER');
    expect(getGpuProfile('INVALID_KEY').key).toBe('BALANCED');
    expect(getGpuProfile(null).key).toBe('BALANCED');
    expect(getGpuProfile(undefined).key).toBe('BALANCED');
  });
});
