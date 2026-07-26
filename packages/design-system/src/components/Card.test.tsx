import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card';

describe('Card', () => {
  it('composes header, content, and footer', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    );
    expect(screen.getByText('Title').tagName).toBe('H3');
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByText('Body')).toBeDefined();
    expect(screen.getByText('Footer')).toBeDefined();
    expect(screen.getByTestId('card').className).toContain('bg-card');
  });
});
