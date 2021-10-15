import React from 'react';
import { render, screen } from '@testing-library/react';
import Screen from '.';
import { GAMEBOY_LOGO_ID } from '../../../utils/constants';

test('renders learn react link', () => {
  render(<Screen />);
  const linkElement = screen.getByTestId(GAMEBOY_LOGO_ID);
  expect(linkElement).toBeInTheDocument();
});
