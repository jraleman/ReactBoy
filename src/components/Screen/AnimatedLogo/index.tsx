import React from 'react';
import { SCREEN_GAMEBOY_LOGO } from '../../../utils/constants';
import './AnimatedLogo.css';
import logo from '../../../assets/logo.svg';

const AnimatedLogo = () => {
    const logoText = 'ReactBoy';
    return (
        <div>
            <div id={SCREEN_GAMEBOY_LOGO}>{logoText}</div>
            <img src={logo} className="logo-img" alt="logo" />
        </div>
    );
};

export default AnimatedLogo;