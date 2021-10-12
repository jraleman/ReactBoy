import React from 'react';
import logo from '../../assets/logo.svg';
import CPU from '../CPU';
import Screen from '../Screen';
import './App.css';

const App = () => {
  return (
    <div className="App">
      <header className="App-header">
        <div className="App-container">
          <Screen />
          <CPU />
        </div>
      </header>
    </div>
  );
};

export default App;
