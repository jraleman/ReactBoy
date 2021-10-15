import React from 'react';
import CPU from '../CPU';
import Screen from '../Screen';
import Body from '../Body';
import { Container, Title } from './styles';

const App = () => {
    const title = 'ReactBoy'
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
