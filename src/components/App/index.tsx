import React from 'react';
import CPU from '../CPU';
import Screen from '../Screen';
import Body from '../Body';
import { Container, Title } from './styles';
import useGameboy from '../../utils/hooks/useGameboy';

const App = () => {
    const { isInit } = useGameboy();
    const title = 'ReactBoy';

    console.log({ isInit });

    return (
        <Container>
            <Title>{title}</Title>
            <Screen />
            <CPU />
            <Body />
        </Container>
    );
};

export default App;
