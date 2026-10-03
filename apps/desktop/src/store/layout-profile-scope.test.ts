import { afterEach, beforeEach, expect, it } from 'vitest'

import { $connectionsRegistry } from '@/store/connection-registry-state'
import {
  $sidebarAgentsGrouped,
  $sidebarGrouping,
  cycleSidebarGrouping,
  resetSidebarView,
  setSidebarAgentsGrouped,
  setSidebarGrouping
} from '@/store/layout'
import { $activeGatewayProfile, $profiles, $profileScope, $showAllProfiles, ALL_PROFILES } from '@/store/profile'
import type { ProfileInfo } from '@/types/hermes'

const profile = (name: string): ProfileInfo => ({
  has_env: false,
  is_default: name === 'default',
  model: null,
  name,
  path: `/tmp/${name}`,
  provider: null,
  skill_count: 0
})

const registry = (ids: string[]) => ({
  connections: ids.map(id => ({
    id,
    kind: 'remote' as const,
    label: id,
    tokenPreview: null,
    tokenSet: false
  })),
  primary: ids[0],
  secureTokenStorage: true,
  version: 2
})

beforeEach(() => {
  $connectionsRegistry.set(null)
  $profiles.set([])
  $activeGatewayProfile.set('default')
  $showAllProfiles.set(false)
  resetSidebarView()
})

afterEach(() => {
  $connectionsRegistry.set(null)
  $profiles.set([])
  $activeGatewayProfile.set('default')
  $showAllProfiles.set(false)
  resetSidebarView()
})

it.each([false, true])('keeps grouping reads and writes with the effective scope (registry: %s)', registered => {
  if (registered) {
    $connectionsRegistry.set(registry(['gateway-a']))
  }

  $profiles.set([profile('default'), profile('work')])
  setSidebarGrouping('status')
  setSidebarGrouping('profile')
  expect($profileScope.get()).toBe(ALL_PROFILES)
  expect($sidebarGrouping.get()).toBe('profile')

  $profiles.set([profile('default')])
  expect($profileScope.get()).toBe('default')
  expect($sidebarGrouping.get()).toBe('status')
  expect($showAllProfiles.get()).toBe(true)
  expect(window.localStorage.getItem('hermes.desktop.showAllProfiles')).toBe('true')

  setSidebarGrouping('project')
  expect($sidebarAgentsGrouped.get()).toBe(true)
  expect(window.localStorage.getItem('hermes.desktop.agentsGroupedByWorkspace')).toBe('true')
  setSidebarAgentsGrouped(false)
  expect($sidebarGrouping.get()).toBe('status')
  cycleSidebarGrouping()
  expect($sidebarGrouping.get()).toBe('date')
  setSidebarGrouping('profile')
  expect($sidebarGrouping.get()).toBe('date')
  setSidebarGrouping('status')
  expect(window.localStorage.getItem('hermes.desktop.sidebarGrouping')).toBe('status')
  expect(window.localStorage.getItem('hermes.desktop.sidebarGrouping.allProfiles')).toBe('profile')

  for (const name of ['default', 'work', 'default']) {
    $activeGatewayProfile.set(name)
    $profiles.set([profile(name)])
    expect($profileScope.get()).toBe(name)
    expect($sidebarGrouping.get()).toBe('status')
  }

  $profiles.set([profile('default'), profile('work')])
  expect($profileScope.get()).toBe(ALL_PROFILES)
  expect($sidebarGrouping.get()).toBe('profile')
  expect($sidebarAgentsGrouped.get()).toBe(false)
  $showAllProfiles.set(false)
  expect($sidebarGrouping.get()).toBe('status')
})

it('preserves gateway grouping with one profile per gateway and restores it after reconnecting', () => {
  $connectionsRegistry.set(registry(['gateway-a']))
  $profiles.set([profile('default')])
  setSidebarGrouping('status')

  $connectionsRegistry.set(registry(['gateway-a', 'gateway-b']))
  setSidebarGrouping('profile')
  expect($profileScope.get()).toBe(ALL_PROFILES)
  expect($sidebarGrouping.get()).toBe('profile')

  $connectionsRegistry.set(registry(['gateway-a']))
  expect($profileScope.get()).toBe('default')
  expect($sidebarGrouping.get()).toBe('status')
  setSidebarGrouping('project')
  expect($sidebarAgentsGrouped.get()).toBe(true)

  $connectionsRegistry.set(registry(['gateway-a', 'gateway-b']))
  expect($profileScope.get()).toBe(ALL_PROFILES)
  expect($sidebarGrouping.get()).toBe('profile')
  expect($sidebarAgentsGrouped.get()).toBe(false)
  $showAllProfiles.set(false)
  expect($sidebarGrouping.get()).toBe('project')
})
