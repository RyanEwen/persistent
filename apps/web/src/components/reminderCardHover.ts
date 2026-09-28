/** A small lift for the full-card links and buttons in reminder lists. */
export const reminderCardHover = {
  transition: 'transform 160ms ease, box-shadow 160ms ease',
  '@media (hover: hover) and (pointer: fine)': {
    '&:hover': { transform: 'translateY(-2px)', boxShadow: 'sm' }
  },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' }
} as const
