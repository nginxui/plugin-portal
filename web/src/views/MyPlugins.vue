<script setup lang="ts">
import { $gettext } from '@/lib/gettext'
</script>

<template>
  <div class="page">
    <div>
      <h1 class="page-title">
        {{ $gettext('My plugins') }}
      </h1>
      <ATypographyText type="secondary">
        {{ $gettext('Manage the plugins you list in the catalog and follow changes under review.') }}
      </ATypographyText>
    </div>
    <ACard>
      <AEmpty :description="$gettext('You have no plugins yet.')" />
    </ACard>
  </div>
</template>
