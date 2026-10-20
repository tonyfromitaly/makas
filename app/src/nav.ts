// A hint for the next screen opened from elsewhere (an agent note's button): which filter or section
// to start on. Read once; a normal tab tap leaves it empty.
let pending: string | undefined;
export const setNavHint = (h?: string) => {
  pending = h;
};
export const takeNavHint = () => {
  const h = pending;
  pending = undefined;
  return h;
};
