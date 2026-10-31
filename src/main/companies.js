// Default list of outsourcing / nearshore / talent-network companies that hire
// developers remotely across LATAM. Each one was checked against its hiring
// platform's public feed (Oct 2026). Users can add, disable or remove companies
// in Settings.
//
// Not included because their job lists aren't available as a public feed:
// Globant, EPAM, BairesDev, Encora, Gorilla Logic, Jobsity, Howdy, Nearsure,
// Making Sense (Hiringroom), Qubika (Manatal), Vairix and ioet (Teamtailor).

const DEFAULT_COMPANIES = [
  { name: 'Endava', platform: 'smartrecruiters', slug: 'endava' },
  { name: 'Applaudo', platform: 'smartrecruiters', slug: 'applaudostudios' },
  { name: 'Agile Engine', platform: 'smartrecruiters', slug: 'agileengine' },
  { name: 'Truelogic', platform: 'ashby', slug: 'truelogic' },
  { name: 'Andela', platform: 'ashby', slug: 'andela' },
  { name: 'Lemon.io', platform: 'ashby', slug: 'lemon-io' },
  { name: 'Wizeline', platform: 'greenhouse', slug: 'wizeline' },
  { name: 'Turing', platform: 'greenhouse', slug: 'turing' },
  { name: 'N-iX', platform: 'greenhouse', slug: 'nix' },
  { name: '10Pearls', platform: 'greenhouse', slug: '10pearlsamerica' },
  { name: 'Arionkoder', platform: 'greenhouse', slug: 'arionkoder' },
  { name: 'Teravision Technologies', platform: 'greenhouse', slug: 'teravision' },
  { name: 'Coderio', platform: 'lever', slug: 'coderio' },
  { name: 'Toptal', platform: 'lever', slug: 'toptal' },
  { name: 'Azumo', platform: 'workable', slug: 'azumo' },
  { name: 'Aerolab', platform: 'recruitee', slug: 'aerolab' },
  { name: 'Flux IT', platform: 'breezy', slug: 'fluxit' },
  { name: 'Sonatafy', platform: 'bamboohr', slug: 'sonatafytechnology' },
  { name: 'Intive', platform: 'workday', slug: 'intive|wd3|Intive' },
].map((c) => ({ ...c, enabled: true }));

module.exports = { DEFAULT_COMPANIES };
