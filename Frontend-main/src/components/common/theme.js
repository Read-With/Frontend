export const theme = {
  colors: {
    // 새로운 색상 팔레트
    primary: '#3E4F2F',      // 가장 진한 녹색
    secondary: '#586544',     // 중간 진한 녹색
    tertiary: '#717B59',     // 중간 녹색
    light: '#B3B6A0',        // 연한 녹색
    background: {
      main: 'linear-gradient(120deg, #F5F1E6 0%, #B3B6A0 100%)',
      card: '#F5F1E6',
      section: '#B3B6A0',
      white: '#fff'
    },
    text: {
      primary: '#3E4F2F',
      secondary: '#586544',
      white: '#fff',
      light: '#717B59'
    },
    border: '#B3B6A0',
    shadow: {
      primary: 'rgba(62,79,47,0.10)',
      card: 'rgba(62,79,47,0.10)',
      hover: 'rgba(62,79,47,0.18)'
    }
  },
  
  gradients: {
    primary: 'linear-gradient(90deg, #3E4F2F 0%, #586544 100%)',
    primaryReverse: 'linear-gradient(90deg, #586544 0%, #3E4F2F 100%)',
    background: 'linear-gradient(120deg, #3E4F2F 0%, #586544 100%)',
    backgroundLight: 'linear-gradient(120deg, #F5F1E6 0%, #B3B6A0 100%)'
  },
  
  spacing: {
    xs: '8px',
    sm: '16px',
    md: '24px',
    lg: '32px',
    xl: '48px'
  },
  
  fontSize: {
    xs: '0.8rem',
    sm: '0.95rem',
    base: '1rem',
    lg: '1.08rem',
    xl: '1.15rem',
    '2xl': '2.1rem',
    '3xl': '2.2rem'
  },
  
  borderRadius: {
    sm: '8px',
    md: '22px',
    lg: '24px',
    xl: '28px',
    full: '999px'
  },
  
  boxShadow: {
    sm: '0 2px 8px rgba(92,111,92,0.10)',
    md: '0 4px 16px rgba(92,111,92,0.13)',
    lg: '0 8px 32px rgba(92,111,92,0.10)',
    hover: '0 12px 32px rgba(92,111,92,0.18)'
  },
  
  breakpoints: {
    mobile: '600px',
    tablet: '900px'
  },
  
  transitions: {
    default: '0.18s',
    slow: '0.3s'
  }
};
