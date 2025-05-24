import React from 'react';
import BookItem from './BookItem';

const BookList = ({ books=[], onSelectBook, darkMode }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '1.5rem',
        padding: '0 1rem',
        width : '800px',
        margin: '1.5rem auto',
      }}
    >
      {books.map((book, index) => (
        <BookItem key={`${book.title}-${index}`} book={book} onClick={onSelectBook} darkMode={darkMode} />
      ))}
    </div>
  );
};

export default BookList;
