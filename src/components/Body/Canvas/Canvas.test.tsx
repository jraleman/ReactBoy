import React from 'react';
import { render, screen } from '@testing-library/react';
import Canvas from '.';
import { CANVAS_ID } from '../../../utils/constants';

test('renders learn react link', () => {
  render(<Canvas />);
  const linkElement = screen.getByTestId(CANVAS_ID);
  expect(linkElement).toBeInTheDocument();
});
