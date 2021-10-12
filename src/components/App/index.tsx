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
          <img src={logo} className="App-logo" alt="logo" />
          <CPU />
        </div>
      </header>
    </div>
  );
};

export default App;
