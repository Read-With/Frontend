import { atom } from 'recoil';

export const graphElementsState = atom({
  key: 'graphElementsState',
  default: [],
});

export const graphLayoutState = atom({
  key: 'graphLayoutState',
  default: {
    zoom: 1,
    pan: { x: 0, y: 0 }
  }
});

export const graphNewNodeIdsState = atom({
  key: 'graphNewNodeIdsState',
  default: []
}); 