import type { QuantumAlgorithmDescriptor } from './types';

/**
 * Algorithms Synora describes but does not execute.
 *
 * ── WHY THEY EXIST AT ALL ────────────────────────────────────────────────
 *
 * An architecture is judged by what it can absorb, and each entry here is a
 * concrete test of whether the algorithm contract in `./types.ts` can hold a
 * method with different data, different circuit structure and different
 * failure modes from the three that are implemented. Every one of them fits
 * without changing the interface. That is the useful information.
 *
 * They are also the honest inventory. A founder deciding what to build next
 * is better served by "here are eight methods, here is what each assumes,
 * here is what it would need, here is why none of them is running" than by
 * a shorter list that implies the omissions do not exist.
 *
 * ── WHY THEY ARE IN ONE FILE ─────────────────────────────────────────────
 *
 * None has an implementation, so eight files would be eight near-identical
 * metadata objects and eight more places to look. When one acquires a `run`,
 * it moves to its own file next to `qaoa.ts` — the split follows the code,
 * not the ambition.
 *
 * ── THE RULE THEY ENFORCE ────────────────────────────────────────────────
 *
 * No `run`. `requireExecutableAlgorithm()` throws
 * `QuantumAlgorithmNotImplementedError` for anything without one, so there
 * is no path by which a caller receives a plausible number from a method
 * nobody implemented. A fabricated benchmark is indistinguishable from a
 * real one once it has been written down, and this is where that would
 * start.
 */

export const quantumNeuralNetworkDescriptor: QuantumAlgorithmDescriptor = {
  id: 'qnn',
  displayName: 'Quantum Neural Network',
  description:
    'A parameterised quantum circuit trained as a model: data encoded into a circuit, ' +
    'variational layers applied, an observable measured as the output, parameters optimised ' +
    'against a loss.',
  problemClasses: ['classification', 'regression'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the encoding places the data somewhere the variational layers can separate',
    'training escapes barren plateaus, which grow exponentially worse with qubit count',
    'the measured observable carries enough signal to define a usable gradient',
  ],
  classicalBaseline:
    'a small classical neural network of comparable parameter count, trained on the same split',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'typically one qubit per input feature, plus ancillas for the readout observable',
  limitations: [
    'barren plateaus: gradient variance decays exponentially in qubit count for most ansatz families',
    'no demonstrated advantage over classical networks on any naturally occurring data set',
    'the parameter count that would make it competitive is far beyond current hardware coherence',
    '"neural network" is an analogy; the mechanism has little in common with a classical one',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: [
    'Benedetti et al. (2019), "Parameterized quantum circuits as machine learning models", QST 4:043001',
    'McClean et al. (2018), "Barren plateaus in quantum neural network training landscapes"',
  ],
};

export const quantumConvolutionalDescriptor: QuantumAlgorithmDescriptor = {
  id: 'qcnn',
  displayName: 'Quantum Convolutional Neural Network',
  description:
    'Alternates translationally-invariant "convolution" unitaries with "pooling" operations that ' +
    'discard qubits, halving the register each layer — a quantum analogue of a CNN, and ' +
    'structurally an inverse MERA tensor network.',
  problemClasses: ['classification'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the data has the local, hierarchical structure the convolution/pooling stack presumes',
    'mid-circuit measurement and conditional operations are available for the pooling layers',
  ],
  classicalBaseline: 'a classical CNN of comparable depth on the same data',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'O(n) for an n-site input; the register halves at each pooling layer',
  limitations: [
    'the log-depth structure genuinely avoids barren plateaus — which is a training property, not an advantage claim',
    'pooling needs mid-circuit measurement and feed-forward, which many devices do not expose',
    'demonstrated mainly on quantum-phase-recognition tasks whose input is itself a quantum state — an application with no classical data equivalent',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Cong, Choi & Lukin (2019), "Quantum convolutional neural networks", Nature Physics 15:1273'],
};

export const quantumReinforcementLearningDescriptor: QuantumAlgorithmDescriptor = {
  id: 'qrl',
  displayName: 'Quantum Reinforcement Learning',
  description:
    'Replaces the policy or value function of an RL agent with a parameterised quantum circuit, ' +
    'trained by policy gradient or Q-learning against a classical environment.',
  problemClasses: ['classification', 'sampling-distribution'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the environment is classical and the circuit only represents the policy',
    'the sample efficiency gain, if any, exceeds the per-evaluation cost of running a circuit',
  ],
  classicalBaseline: 'the same RL algorithm with a small classical policy network',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'roughly one qubit per state feature, plus action-space encoding',
  limitations: [
    'every environment step becomes a circuit execution, so wall-clock and cost dominate any sample-efficiency gain',
    'training instability compounds RL variance with variational-circuit variance',
    'results to date are on toy environments (CartPole-scale) where classical agents are already trivial',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Jerbi et al. (2021), "Parametrized quantum policies for reinforcement learning", NeurIPS 34'],
};

export const quantumBoltzmannMachineDescriptor: QuantumAlgorithmDescriptor = {
  id: 'qbm',
  displayName: 'Quantum Boltzmann Machine',
  description:
    'A generative model whose energy function is a transverse-field Ising Hamiltonian, trained ' +
    'to match a data distribution by sampling from its thermal state.',
  problemClasses: ['sampling-distribution'],
  formulation: 'Ising',
  assumptions: [
    'a thermal state at the target temperature can actually be prepared or sampled',
    'the transverse field buys expressiveness a classical RBM cannot match',
  ],
  classicalBaseline: 'a classical restricted Boltzmann machine trained by contrastive divergence',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'one qubit per visible and hidden unit',
  limitations: [
    'preparing a Gibbs state is itself hard; annealers approximate it with an uncontrolled effective temperature',
    'the gradient of the quantum relative entropy is not directly measurable, so training uses bounds rather than the true objective',
    'classical RBMs are themselves largely superseded by other generative models, so the baseline is a weak target',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Amin et al. (2018), "Quantum Boltzmann Machine", Physical Review X 8:021050'],
};

export const quantumReservoirDescriptor: QuantumAlgorithmDescriptor = {
  id: 'quantum-reservoir',
  displayName: 'Quantum Reservoir Computing',
  description:
    'Drives a fixed, untrained quantum system with an input signal and fits a classical linear ' +
    'readout to its observables. Only the readout is trained.',
  problemClasses: ['regression', 'classification', 'simulation-dynamics'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the reservoir has the echo-state property — its dependence on initial conditions fades',
    'the measured observables span a rich enough feature space for a linear readout',
  ],
  classicalBaseline: 'a classical echo-state network with a comparable number of readout features',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: '5–15 qubits is the usual regime; the reservoir need not be large',
  limitations: [
    'temporal tasks need repeated re-preparation because measurement destroys the state',
    'no training of the reservoir means no way to fix a reservoir that suits the task badly',
    'the strongest results are on tasks classical reservoirs already handle well',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Fujii & Nakajima (2017), "Harnessing disordered-ensemble quantum dynamics for machine learning", PR Applied 8:024030'],
};

export const quantumGenerativeDescriptor: QuantumAlgorithmDescriptor = {
  id: 'quantum-generative',
  displayName: 'Quantum Generative Model (QCBM / QGAN)',
  description:
    'Trains a parameterised circuit so that its measurement distribution matches a target — ' +
    'either directly (Born machine, MMD loss) or adversarially against a discriminator.',
  problemClasses: ['sampling-distribution'],
  formulation: 'none',
  assumptions: [
    'the target distribution is one a Born-rule distribution can represent compactly',
    'enough samples are affordable to estimate the loss, which is a distribution-level quantity',
  ],
  classicalBaseline: 'a classical generative model (VAE, normalising flow, or a small GAN) on the same target',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'one qubit per output bit',
  limitations: [
    'estimating a distribution-matching loss needs many shots per gradient step, making training extremely sample-hungry',
    'adversarial training adds classical GAN instability on top of variational instability',
    'demonstrated on distributions of a few dozen bits; classical models handle vastly larger ones',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: [
    'Benedetti et al. (2019), "A generative modeling approach for benchmarking and training shallow quantum circuits", npj QI 5:45',
  ],
};

export const hybridQuantumClassicalNetworkDescriptor: QuantumAlgorithmDescriptor = {
  id: 'hybrid-qc-nn',
  displayName: 'Hybrid Quantum-Classical Neural Network',
  description:
    'A classical network with one or more parameterised quantum circuits as layers, trained ' +
    'end-to-end by backpropagating through the circuit via the parameter-shift rule.',
  problemClasses: ['classification', 'regression'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the parameter-shift rule provides usable gradients at the achievable shot count',
    'the quantum layer contributes something the surrounding classical layers cannot',
  ],
  classicalBaseline: 'the identical network with the quantum layer replaced by a dense layer of equal width',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'set by the quantum layer width, typically 4–20 qubits',
  limitations: [
    'the parameter-shift rule costs two circuit evaluations per parameter per step — the dominant expense by far',
    'ablation studies frequently show the classical layers carrying the performance, which is why the stated baseline is the ablation',
    'the quantum layer is a bottleneck in both latency and gradient quality',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Mari et al. (2020), "Transfer learning in hybrid classical-quantum neural networks", Quantum 4:340'],
};

export const variationalFamilyDescriptor: QuantumAlgorithmDescriptor = {
  id: 'vqa',
  displayName: 'Variational Quantum Algorithms (family)',
  description:
    'The umbrella pattern: a parameterised circuit, a measured cost function, and a classical ' +
    'optimiser in the loop. QAOA and VQE in this registry are concrete, executable instances; ' +
    'this entry describes the shared structure and the shared failure modes.',
  problemClasses: ['combinatorial-optimisation', 'ground-state-energy', 'classification', 'regression'],
  formulation: 'Hamiltonian',
  assumptions: [
    'the ansatz can express a good solution (expressibility)',
    'the optimiser can find it (trainability) — these two pull in opposite directions',
    'the cost function is measurable to sufficient precision within an affordable shot budget',
  ],
  classicalBaseline: 'whatever the specific instance names; a variational result without one is not a result',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'instance-specific',
  limitations: [
    'the expressibility/trainability trade-off is structural: an ansatz expressive enough to hold the answer is usually flat enough to hide it',
    'shot noise puts a floor on optimiser precision that no classical optimiser removes',
    'this entry has no `run` on purpose — the family is a pattern, and only its instances execute',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Cerezo et al. (2021), "Variational quantum algorithms", Nature Reviews Physics 3:625'],
};

/* ── Reference entries: textbook algorithms the analyzer may name ──────── */

export const groverDescriptor: QuantumAlgorithmDescriptor = {
  id: 'grover',
  displayName: "Grover's Algorithm",
  description:
    'Amplitude amplification: finds a marked item among N in O(√N) oracle queries rather than O(N).',
  problemClasses: ['unstructured-search'],
  formulation: 'oracle',
  assumptions: [
    'the predicate can be implemented as a reversible circuit acting on a SUPERPOSITION — not merely as a classical function',
    'the number of solutions is known, or is found by an additional counting procedure',
  ],
  classicalBaseline: 'linear scan, or any structure-exploiting classical search the problem actually admits',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'log₂(N) qubits for the search register, plus the oracle\'s own ancillas',
  limitations: [
    'the speedup is QUADRATIC, and quadratic is not enough to survive the constant factors of error correction at any near-term scale',
    'building the oracle usually costs more than the search saves — the database must be computable, not stored',
    'proven optimal for unstructured search, which means it cannot be improved and also that any structure a classical algorithm can exploit beats it',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Grover (1996), "A fast quantum mechanical algorithm for database search", STOC'],
};

export const shorDescriptor: QuantumAlgorithmDescriptor = {
  id: 'shor',
  displayName: "Shor's Algorithm",
  description: 'Factors integers in polynomial time via quantum order-finding.',
  problemClasses: ['factoring'],
  formulation: 'oracle',
  assumptions: ['a fault-tolerant, error-corrected quantum computer'],
  classicalBaseline: 'the general number field sieve',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement:
    'about 2n+3 LOGICAL qubits for an n-bit integer — which is millions of physical qubits under any known error-correcting code',
  limitations: [
    'requires fault tolerance that does not exist; every "factored on a quantum computer" headline to date used a simplified circuit that presupposed the answer',
    'no near-term device is within many orders of magnitude of a cryptographically relevant instance',
    'listed here so the analyzer can name it and immediately explain why it does not apply',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Shor (1997), "Polynomial-Time Algorithms for Prime Factorization…", SIAM J. Comput. 26:1484'],
};

export const hhlDescriptor: QuantumAlgorithmDescriptor = {
  id: 'hhl',
  displayName: 'HHL Linear Systems Algorithm',
  description: 'Prepares a quantum state proportional to the solution of a sparse linear system Ax = b.',
  problemClasses: ['linear-algebra'],
  formulation: 'Hamiltonian',
  assumptions: [
    'A is sparse and well-conditioned',
    'b can be prepared as a quantum state efficiently',
    'only an EXPECTATION of the solution is needed, never the solution vector itself',
  ],
  classicalBaseline: 'conjugate gradient, or a randomised sketching method',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'log(N) for the solution register plus a large ancilla for phase estimation',
  limitations: [
    'the three caveats above are what the exponential speedup is purchased with, and they eliminate most real applications',
    'reading the solution out destroys the speedup entirely',
    'several claimed HHL applications were later "dequantised" — matched by classical randomised algorithms',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: [
    'Harrow, Hassidim & Lloyd (2009), "Quantum algorithm for linear systems of equations", PRL 103:150502',
    'Tang (2019), "A quantum-inspired classical algorithm for recommendation systems", STOC — the dequantisation result',
  ],
};

export const trotterSimulationDescriptor: QuantumAlgorithmDescriptor = {
  id: 'trotter-simulation',
  displayName: 'Trotterised Hamiltonian Simulation',
  description:
    'Approximates time evolution exp(−iHt) by a product of short evolutions under each term of H.',
  problemClasses: ['simulation-dynamics'],
  formulation: 'Hamiltonian',
  assumptions: ['H decomposes into terms that are individually easy to exponentiate'],
  classicalBaseline: 'exact diagonalisation for small systems; tensor-network methods for larger ones',
  simulatorSupported: false,
  qpuSupported: false,
  qubitRequirement: 'one qubit per two-level system being simulated',
  limitations: [
    'circuit depth grows with evolution time and inversely with the acceptable Trotter error',
    'this is the application class with the strongest theoretical case for quantum computing and still no unambiguous practical demonstration',
    'tensor-network methods keep advancing the classical frontier for the systems most often proposed as targets',
  ],
  state: 'DESCRIBED',
  testCoverage: 'none',
  references: ['Lloyd (1996), "Universal Quantum Simulators", Science 273:1073'],
};
