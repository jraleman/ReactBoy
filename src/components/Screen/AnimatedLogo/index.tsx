import React from 'react';
import { GAMEBOY_LOGO_ID } from '../../../utils/constants';
import { LogoImg, LogoContainer, LogoText } from './styles';
import logo from '../../../assets/logo.svg';
import './AnimatedLogo.css';

const AnimatedLogo = () => {
    const logoText = 'ReactBoy';
    return (
        <LogoContainer >
            <LogoImg src={logo} alt="logo" />
            <LogoText id={GAMEBOY_LOGO_ID}>{logoText}</LogoText>
        </LogoContainer>
    );
};

export default AnimatedLogo;