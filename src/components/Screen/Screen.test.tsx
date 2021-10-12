import React from 'react';
import { render, screen } from '@testing-library/react';
import Screen from '.';
import { SCREEN_ID } from '../../utils/constants';

test('renders learn react link', () => {
  render(<Screen />);
  const linkElement = screen.getByTestId(SCREEN_ID);
  expect(linkElement).toBeInTheDocument();
});
