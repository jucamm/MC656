import { chamberSource, senateSource } from './federal-sources';
import { regionalSources } from './regional-sources';

export const legislativeSources = [senateSource(), chamberSource(), ...regionalSources];
