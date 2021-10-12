import React from 'react';
import { render, screen } from '@testing-library/react';
import Screen from '.';
import { SCREEN_GAMEBOY_LOGO } from '../../../utils/constants';

test('renders learn react link', () => {
  render(<Screen />);
  const linkElement = screen.getByTestId(SCREEN_GAMEBOY_LOGO);
  expect(linkElement).toBeInTheDocument();
});
