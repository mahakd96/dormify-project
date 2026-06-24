# Case 02 - Soft tradeoff, bad one-sided roommate request

Same as case 01, but S02 asks for S16. This request conflicts with religion/sector/year grouping, and it is only one-sided.

## Expected result

- successful_assignments should still be 20.
- S02 and S16 should probably NOT be placed in the same apartment.
- The algorithm should prefer the stronger global quality: same sector/religion/year groups.
- This tests whether a weak roommate preference does not destroy a better apartment grouping.

## What to check after running

- Check successful_assignments == 20.
- Check S02 apartment != S16 apartment.
- Check S02 remains with the Arab/Muslim/religious group if possible.
- Check S16 remains with Jewish/non-religious/Year3-4 group if possible.
