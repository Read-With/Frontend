import React from 'react';
import BookItem from './BookItem';

const BookList = ({ books=[], onSelectBook, darkMode }) => {

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '1rem',
        marginTop: '1rem',
      }}
    >
      {books.map((book, index) => (
        <BookItem key={`${book.title}-${index}`} book={book} onClick={onSelectBook} darkMode={darkMode} />
      ))}
    </div>
  );
};

export default BookList;
