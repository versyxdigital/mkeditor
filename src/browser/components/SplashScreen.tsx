import React from 'react';

export default function SplashScreen() {
  return (
    <div
      id="splashscreen"
      className="position-absolute top-0 bottom-0 h-100 w-100 align-items-center text-center"
    >
      <div className="w-100">
        <img src="./icon.png" className="img-fluid app-logo mb-3" />
        <h1>mkeditor</h1>
        <small>markdown made simple</small>
      </div>
    </div>
  );
}
