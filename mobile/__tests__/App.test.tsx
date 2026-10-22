/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';
import {act} from 'react-test-renderer';

// Note: import explicitly to use the types shipped with jest.
import {it, jest} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer from 'react-test-renderer';

jest.mock('react-native-video', () => ({
  __esModule: true,
  default: 'Video',
}));

jest.mock('../src/api/client', () => ({
  api: {
    getBaseUrl: () => 'http://10.0.2.2:8000',
    videoUrl: () => 'http://10.0.2.2:8000/api/v1/live/video',
    health: () => Promise.resolve({status: 'ok'}),
    liveStatus: () => Promise.resolve({status: 'idle'}),
    detections: () => Promise.resolve({status: 'idle', detections: []}),
    startTracking: () => Promise.resolve({status: 'idle'}),
    stopTracking: () => Promise.resolve({status: 'idle'}),
  },
}));

it('renders and unmounts correctly', async () => {
  let tree: ReturnType<typeof renderer.create> | undefined;
  await act(async () => {
    tree = renderer.create(<App />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  act(() => {
    tree?.unmount();
  });
});
