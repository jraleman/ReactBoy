import React from 'react';
import { SCREEN_ID } from '../../utils/constants';
import './Screen.css';
import ScreenGameboyLogo from './ScreenGameboyLogo';

const Screen = () => {
    return (
        <div id={SCREEN_ID}>
            <ScreenGameboyLogo />
        </div>
    );
};

export default Screen;