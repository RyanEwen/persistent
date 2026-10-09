/** Shared checklist text contrast for list previews and reading dialogs. */
export function checklistItemTextSx(checked: boolean) {
  return {
    color: checked ? 'text.tertiary' : 'text.secondary',
    textDecoration: checked ? 'line-through' : 'none'
  }
}
