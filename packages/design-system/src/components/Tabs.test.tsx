import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs';

describe('Tabs', () => {
  it('shows the default tab and switches on click', () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>
    );
    expect(screen.getByText('First panel')).toBeDefined();
    expect(screen.queryByText('Second panel')).toBeNull();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Two' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByText('Second panel')).toBeDefined();
  });
});
