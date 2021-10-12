import React from 'react';
import CPU from '../CPU';
import Screen from '../Screen';
import Body from '../Body';
import './App.css';

const App = () => {
  return (
    <div className="App">
      <header className="App-header">
        <div className="App-container">
          <Screen />
          <CPU />
          <Body />
        </div>
      </header>
    </div>
  );
};

export default App;
