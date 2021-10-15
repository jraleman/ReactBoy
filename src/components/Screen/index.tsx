import React from 'react';
import { SCREEN_ID } from '../../utils/constants';
import AnimatedLogo from './AnimatedLogo';
import { ScreenCover } from './styles';

const Screen = () => {
    return (
        <ScreenCover id={SCREEN_ID}>
            <AnimatedLogo />
        </ScreenCover>
    );
};

export default Screen;