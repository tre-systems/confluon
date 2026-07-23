# Research basis

Confluence is an original musical instrument informed by the published Particle
Lenia model and its energy-based interpretation. The reference describes particles
that induce a radial shell field, seek a preferred field density through a Gaussian
growth function, repel at close range, and move down their own local energy gradient.
It also shows why local greedy descent produces richer dynamic attractors than global
energy minimisation.

The most relevant findings for this instrument are:

- constant particle count gives a simple mass-conservation invariant;
- a shell kernel and close-range repulsion can produce dynamic formations;
- local and global optimisation create meaningfully different behaviour;
- energy history exposes phase transitions;
- the reference sonification maps particle energy to pitch and speed to volume.

The visual redesign also compared two working browser implementations and the local
Galacto instrument. The useful architectural findings were consistent:

- hundreds or thousands of small, visible particles read as material; a sparse set
  of large discs does not;
- a spatial neighbour grid makes dense CPU dynamics practical without changing the
  local rule;
- additive particle splats into a floating-point field texture can reveal the kernel
  and growth response while crisp point cores preserve the organism's actual shape;
- particle size must decrease as population count rises; and
- fabricated hulls and nucleus overlays make a picture more immediately cell-like,
  but conceal whether the simulation itself has organised.

Confluence therefore starts with 2,000 particles in 24 compact single-population
colonies, uses a wrapped spatial grid for neighbourhood visits, and draws no hulls.
Its coloured matter and membrane contours are direct responses to the accumulated
particle field. Cross-population sensing is deliberately weaker than the internal
formation rule: enough to create pursuit, collision, and deformation, but not enough
to dissolve every colony at once.

Confluence keeps the field, repulsion, and local-energy ideas, but develops an
independent browser implementation and a different musical mapping. It sonifies
collective metrics with a small resonator ensemble rather than assigning one audible
oscillator to every particle. No upstream code, saved creatures, images, names, or
other creative assets are included.

Primary sources:

- [Particle Lenia and the energy-based formulation](https://google-research.github.io/self-organising-systems/particle-lenia/)
- [Interactive Particle Lenia demonstration](https://znah.net/lenia/)
- [Reproducible notebook](https://github.com/google-research/self-organising-systems/blob/master/notebooks/particle_lenia.ipynb)
- [Upstream source licence](https://github.com/google-research/self-organising-systems/blob/master/LICENSE)
- [Public multi-species browser reference](https://leonbzt.itch.io/particular)
- [Reference development discussion](https://www.reddit.com/r/proceduralgeneration/comments/1v1igs2/a_browser_toy_where_creatures_made_of_particles/)
