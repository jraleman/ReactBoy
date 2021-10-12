import React from 'react';
import { SCREEN_ID } from '../../utils/constants';
import './Screen.css';
import AnimatedLogo from './AnimatedLogo';

const Screen = () => {
    return (
        <div id={SCREEN_ID}>
            <AnimatedLogo />
        </div>
    );
};

export default Screen;