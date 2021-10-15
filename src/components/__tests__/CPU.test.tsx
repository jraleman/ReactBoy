import React from 'react';
import { render, screen } from '@testing-library/react';
import CPU from '.';
import { PROCESSOR_ID } from '../../utils/constants';

test('renders learn react link', () => {
  render(<CPU />);
  const linkElement = screen.getByTestId(PROCESSOR_ID);
  expect(linkElement).toBeInTheDocument();
});
