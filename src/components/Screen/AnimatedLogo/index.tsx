import React from 'react';
import { SCREEN_GAMEBOY_LOGO } from '../../../utils/constants';
import { LogoImg } from './styles';
import './AnimatedLogo.css';
import logo from '../../../assets/logo.svg';

const AnimatedLogo = () => {
    const logoText = 'ReactBoy';
    return (
        <div>
            <div id={SCREEN_GAMEBOY_LOGO}>{logoText}</div>
            <LogoImg src={logo} alt="logo" />
        </div>
    );
};

export default AnimatedLogo;