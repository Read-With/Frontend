export const getNodeSize = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) return 40;
    if (path.includes('/user/graph/')) {
      return context === 'viewer' ? 45 : 40;
    }
  }

  return context === 'viewer' ? 40 : 40;
};

export const getEdgeStyle = (context = 'default') => {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname || '';
    if (path.includes('/user/viewer/')) {
      return {
        width: 'data(weight)',
        fontSize: context === 'viewer' ? 8 : 9,
      };
    }
    if (path.includes('/user/graph/')) {
      return {
        width: 'data(weight)',
        fontSize: 11,
      };
    }
  }

  return {
    width: 'data(weight)',
    fontSize: context === 'viewer' ? 8 : 9,
  };
};

export const getRelationColor = (positivity) => {
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};


