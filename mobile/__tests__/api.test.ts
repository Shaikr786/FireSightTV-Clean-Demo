import {describe, expect, it} from '@jest/globals';
import {api, normalizeApiBaseUrl} from '../src/api/client';

describe('backend URL configuration', () => {
  it('normalizes a valid backend address and removes its trailing slash', () => {
    expect(normalizeApiBaseUrl('  https://demo.example.test/  ')).toBe(
      'https://demo.example.test',
    );
  });

  it('rejects unsupported protocols and credentials', () => {
    expect(() => normalizeApiBaseUrl('ftp://demo.example.test')).toThrow(
      'Backend URL must use HTTP or HTTPS',
    );
    expect(() =>
      normalizeApiBaseUrl('https://user:pass@demo.example.test'),
    ).toThrow('Backend URL must use HTTP or HTTPS');
  });

  it('updates API and video endpoint URLs together', () => {
    const originalBaseUrl = api.getBaseUrl();

    try {
      api.setBaseUrl('http://192.168.1.20:8000/');
      expect(api.getBaseUrl()).toBe('http://192.168.1.20:8000');
      expect(api.videoUrl()).toBe(
        'http://192.168.1.20:8000/api/v1/live/video',
      );
    } finally {
      api.setBaseUrl(originalBaseUrl);
    }
  });
});
