import React from 'react';

const BookItem = ({ book, onClick, darkMode }) => {
  return (
    <div
      key={`${book.title}-${book.author}`}
      onClick={() => onClick(book)}
      style={{
        cursor: 'pointer',
        backgroundColor: darkMode ? '#222' : '#f9f9f9',
        borderRadius: '8px',
        padding: '0.5rem',
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        transition: 'transform 0.2s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      <img
        src={book.image || 'https://via.placeholder.com/120x160?text=No+Image'}
        alt={book.title}
        style={{ width: '100%', height: '200px', objectFit: 'cover', borderRadius: '4px' }}
      />
      <div
        title={book.title}
        style={{
          marginTop: '0.5rem',
          fontWeight: 'bold',
          fontSize: '0.95rem',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
        }}
      >
        {book.title}
      </div>
      <div style={{ fontSize: '0.875rem', color: darkMode ? '#aaa' : '#555' }}>
        {book.author}
      </div>
    </div>
  );
};

export default BookItem;
