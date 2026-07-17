// @vitest-environment jsdom
// Skipped until the mobile test harness includes these tests and their DOM dependencies.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { FleetScreen } from './FleetScreen'
import { MockFleetSource } from '../data/MockFleetSource'

describe.skip('FleetScreen', () => {
  it('renders workers and fires onOpen on tap', async () => {
    const onOpen = vi.fn()
    render(<FleetScreen source={new MockFleetSource()} onOpen={onOpen} />)
    await waitFor(() => expect(screen.getByText('codex')).toBeInTheDocument())
    fireEvent.click(screen.getByText('codex'))
    expect(onOpen).toHaveBeenCalledWith('w-alpha')
  })
})
