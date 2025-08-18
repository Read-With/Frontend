import React from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';

const BookCard = ({ book }) => {
  const navigate = useNavigate();

  const cardStyle = {
    background: theme.colors.background.card,
    border: `1.5px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: theme.boxShadow.sm,
    width: '180px',
    height: '320px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: '20px 16px',
    boxSizing: 'border-box',
    cursor: 'pointer',
    transition: `transform ${theme.transitions.default}, box-shadow ${theme.transitions.default}`,
    position: 'relative'
  };

  const cardHoverStyle = {
    ...cardStyle,
    transform: 'translateY(-8px) scale(1.03)',
    boxShadow: theme.boxShadow.hover
  };

  const imageContainerStyle = {
    width: '80px',
    height: '120px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const imageStyle = {
    width: '80px',
    height: '120px',
    objectFit: 'cover',
    borderRadius: theme.borderRadius.sm,
    boxShadow: '0 2px 8px #b0b8c1cc'
  };

  const textContentStyle = {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
    position: 'relative',
    minWidth: 0
  };

  const titleStyle = {
    fontWeight: 600,
    fontSize: theme.fontSize.lg,
    lineHeight: '1.3',
    minHeight: '1.5em',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    width: '100%'
  };

  const authorStyle = {
    fontWeight: 400,
    fontSize: '0.97rem',
    color: theme.colors.text.secondary,
    lineHeight: '1.2',
    minHeight: '1.5em',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    width: '100%'
  };

  const buttonsStyle = {
    display: 'flex',
    gap: '6px',
    justifyContent: 'center',
    marginTop: '10px'
  };

  const primaryButtonStyle = {
    padding: '2px 10px',
    fontSize: theme.fontSize.xs,
    borderRadius: theme.borderRadius.full,
    background: theme.gradients.primary,
    color: theme.colors.text.white,
    border: 'none',
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: '70px',
    transition: `transform ${theme.transitions.default}, background ${theme.transitions.default}`
  };

  const secondaryButtonStyle = {
    padding: '2px 10px',
    fontSize: theme.fontSize.xs,
    borderRadius: theme.borderRadius.full,
    background: '#f0f4fa',
    color: theme.colors.primary,
    border: 'none',
    fontWeight: 600,
    cursor: 'pointer',
    minWidth: '70px',
    transition: `transform ${theme.transitions.default}`
  };

  const [isHovered, setIsHovered] = React.useState(false);

  const handleReadClick = (e) => {
    e.stopPropagation();
    navigate(`/user/viewer/${book.filename}`);
  };

  const handleGraphClick = (e) => {
    e.stopPropagation();
    navigate(`/user/graph/${book.filename}`);
  };

  const renderBookImage = () => {
    if (book.cover) {
      return <img src={book.cover} alt={book.title} style={imageStyle} />;
    }
    
    return (
      <svg width="80" height="120" viewBox="0 0 80 120" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="10" y="16" width="60" height="88" rx="8" fill="#b0b8c1" />
        <rect x="18" y="28" width="44" height="64" rx="4" fill="#e3e9f7" />
        <rect x="22" y="36" width="36" height="6" rx="3" fill="#b0b8c1" />
        <rect x="22" y="48" width="26" height="6" rx="3" fill="#b0b8c1" />
      </svg>
    );
  };

  return (
    <div 
      style={isHovered ? cardHoverStyle : cardStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={imageContainerStyle}>
        {renderBookImage()}
      </div>
      <div style={textContentStyle}>
        <div style={{ width: '100%' }}>
          <div style={titleStyle}>{book.title}</div>
          <div style={authorStyle}>{book.author}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={buttonsStyle}>
          <button style={primaryButtonStyle} onClick={handleReadClick}>
            읽기
          </button>
          <button style={secondaryButtonStyle} onClick={handleGraphClick}>
            그래프
          </button>
        </div>
      </div>
    </div>
  );
};

BookCard.propTypes = {
  book: PropTypes.shape({
    title: PropTypes.string.isRequired,
    filename: PropTypes.string.isRequired,
    cover: PropTypes.string,
    author: PropTypes.string.isRequired
  }).isRequired
};

export default BookCard;
