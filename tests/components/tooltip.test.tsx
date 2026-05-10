import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Tooltip } from '@/app/(dashboard)/tenders/[id]/Tooltip'

describe('Tooltip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not render content initially', () => {
    render(
      <Tooltip content="Hello world">
        <button>Trigger</button>
      </Tooltip>
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('renders content after delay on hover', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Hello world" delay={150}>
        <button>Trigger</button>
      </Tooltip>
    )
    fireEvent.mouseEnter(screen.getByText('Trigger').parentElement!)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Hello world')
  })

  it('hides content when mouse leaves', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Hello world" delay={100}>
        <button>Trigger</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Trigger').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('cancels pending show if mouse leaves before delay', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Hello world" delay={150}>
        <button>Trigger</button>
      </Tooltip>
    )
    const wrapper = screen.getByText('Trigger').parentElement!
    fireEvent.mouseEnter(wrapper)
    act(() => { vi.advanceTimersByTime(50) })
    fireEvent.mouseLeave(wrapper)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
