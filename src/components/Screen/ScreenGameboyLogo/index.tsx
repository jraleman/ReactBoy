import React from 'react';
import { SCREEN_GAMEBOY_LOGO } from '../../../utils/constants';
import './ScreenGameboyLogo.css';

const ScreenGameboyLogo = () => {
    const logoText = 'ReactBoy';
    return <div id={SCREEN_GAMEBOY_LOGO}>{logoText}</div>;
};

export default ScreenGameboyLogo;